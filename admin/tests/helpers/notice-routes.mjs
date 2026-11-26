// Where the results Admin's Server Actions seal end up (src/lib/notice.ts), read from the code as the compiler sees
// it, for tests/notice-routes.test.mjs. An action seals a result with noticeHref(path, code, binding, { param }) and a
// page opens it with pageNotice(<that param>, <the same binding>); nothing but the code itself ties the two together.
// Each noticeHref is read once for every chain of calls that reaches it (the action's call of its helper, the helper's
// call of noticeHref), so an address goes with the codes sent along with it. Its arguments are followed through
// parameters (what that call passes), constants, conditionals, functions' returns (also a function imported from
// another admin module, through `load`) and object literals' properties; whatever cannot be followed (a value from the
// form, a database's message) is reported by its text, so the test can say what it can be.
import ts from "typescript";
import { parseTsx } from "./jsx-scan.mjs";

const isFunctionLike = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
  return node;
}

const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

/** What an identifier refers to, by the scopes around it: a parameter, a local constant, a function; null for an import. */
function declarationOf(identifier) {
  const name = identifier.text;
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      const index = scope.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name);
      if (index >= 0) return { kind: "parameter", fn: scope, index, node: scope.parameters[index] };
    }
    for (const statement of scope.statements ?? []) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { kind: "function", fn: statement };
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { kind: "variable", node: declaration };
        if (ts.isObjectBindingPattern(declaration.name)) {
          const element = declaration.name.elements.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === name);
          if (element) return { kind: "binding", node: declaration, element };
        }
      }
    }
  }
  return null;
}

/** The function a declaration names (a function, or a constant holding an arrow function), or null. */
function functionOf(declaration) {
  if (declaration?.kind === "function") return declaration.fn;
  const value = declaration?.kind === "variable" ? unwrap(declaration.node.initializer) : null;
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : null;
}

/** A function another admin module defines under this name (a function, or a constant holding an arrow function). */
function definedFunction(file, name) {
  for (const statement of file?.statements ?? []) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return functionOf({ kind: "variable", node: declaration });
    }
  }
  return null;
}

/** The function a callee names: one in its own file, or one imported from an admin module `load` can read. */
function calledFunction(callee, load) {
  const local = functionOf(declarationOf(callee));
  if (local) return local;
  for (const statement of callee.getSourceFile().statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    const element = named && ts.isNamedImports(named) ? named.elements.find((entry) => entry.name.text === callee.text) : null;
    if (element) return definedFunction(load(statement.moduleSpecifier.text), (element.propertyName ?? element.name).text);
  }
  return null;
}

const callCache = new WeakMap();
/** Every call of this function in its own file. */
function callsOf(fn) {
  if (callCache.has(fn)) return callCache.get(fn);
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && functionOf(declarationOf(node.expression)) === fn) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(fn.getSourceFile());
  callCache.set(fn, calls);
  return calls;
}

/** What a function returns: an arrow's expression, or each return statement's (not those of functions inside it). */
function returnsOf(fn) {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const found = [];
  const visit = (node) => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return found;
}

/** A function's parameters bound to what one call passes (each argument read where the call is, with that call's own bindings). */
function bind(fn, call, outer) {
  const env = new Map();
  fn.parameters.forEach((parameter, index) => env.set(parameter, { argument: call.arguments[index] ?? parameter.initializer, env: outer }));
  return env;
}

/**
 * What an expression can be: strings (a template's ${…} as "*"), object literals (with the bindings they were made
 * under), and the text of each part that could not be followed. null and undefined are nothing. `env` binds a
 * function's parameters to the arguments of the call being followed; an unbound parameter is whatever any call passes.
 */
export function valuesOf(expression, load = () => null, env = new Map(), stack = new Set()) {
  const result = { strings: new Set(), objects: [], unknown: [] };
  const add = (more) => {
    for (const value of more.strings) result.strings.add(value);
    result.objects.push(...more.objects);
    result.unknown.push(...more.unknown);
  };
  const node = unwrap(expression);
  if (!node || stack.has(node)) return result;
  stack.add(node);
  const follow = (next, nextEnv = env) => add(valuesOf(next, load, nextEnv, stack));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) result.strings.add(node.text);
  else if (ts.isTemplateExpression(node)) result.strings.add(node.head.text + node.templateSpans.map((span) => `*${span.literal.text}`).join(""));
  else if (ts.isConditionalExpression(node)) [node.whenTrue, node.whenFalse].forEach((branch) => follow(branch));
  else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) [node.left, node.right].forEach((side) => follow(side));
  else if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined")) {
    // Not a value a result can have.
  } else if (ts.isObjectLiteralExpression(node)) result.objects.push({ node, env });
  else if (ts.isIdentifier(node)) {
    const declaration = declarationOf(node);
    if (declaration?.kind === "variable" && declaration.node.initializer) follow(declaration.node.initializer);
    else if (declaration?.kind === "parameter" && env.has(declaration.node)) {
      const bound = env.get(declaration.node);
      follow(bound.argument, bound.env);
    } else if (declaration?.kind === "parameter") {
      const calls = callsOf(declaration.fn);
      for (const call of calls) follow(call.arguments[declaration.index] ?? declaration.node.initializer, new Map());
      if (!calls.length) result.unknown.push(node.getText());
    } else result.unknown.push(node.getText());
  } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && calledFunction(node.expression, load)) {
    const fn = calledFunction(node.expression, load);
    const callEnv = bind(fn, node, env);
    for (const returned of returnsOf(fn)) follow(returned, callEnv);
  } else if (ts.isPropertyAccessExpression(node)) {
    const owner = valuesOf(node.expression, load, env, stack);
    const property = node.name.text;
    if (owner.objects.length && !owner.unknown.length) {
      for (const { node: object, env: objectEnv } of owner.objects) {
        const entry = object.properties.find((candidate) => candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === property);
        if (entry && ts.isPropertyAssignment(entry)) follow(entry.initializer, objectEnv);
        else if (entry && ts.isShorthandPropertyAssignment(entry)) follow(entry.name, objectEnv);
        // An object without the property gives undefined ({ ok: true } has no error); a spread could hold it.
        else if (object.properties.some((candidate) => ts.isSpreadAssignment(candidate))) result.unknown.push(node.getText());
      }
    } else result.unknown.push(node.getText());
  } else result.unknown.push(node.getText());
  stack.delete(node);
  return result;
}

/** The parameter a noticeHref's options name ("notice" when none is given), or null when the code does not say. */
function paramOf(options) {
  const node = unwrap(options);
  if (!node) return "notice";
  if (!ts.isObjectLiteralExpression(node)) return null;
  const entry = node.properties.find((candidate) => candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === "param");
  if (!entry) return "notice";
  return ts.isPropertyAssignment(entry) && ts.isStringLiteral(unwrap(entry.initializer)) ? unwrap(entry.initializer).text : null;
}

function enclosingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (isFunctionLike(parent)) return parent;
  return null;
}

/**
 * The chains of calls that reach a node: for each, its function's parameters bound to what that chain's call passes,
 * and the lines of the chain's calls, the action's own first. An action called by nothing in its file (Next calls it)
 * is one chain with nothing bound.
 */
function chainsTo(node, depth = 0) {
  const fn = enclosingFunction(node);
  const calls = fn ? callsOf(fn) : [];
  if (!calls.length || depth > 8) return [{ env: new Map(), lines: [] }];
  return calls.flatMap((call) => chainsTo(call, depth + 1).map((outer) => ({ env: bind(fn, call, outer.env), lines: [...outer.lines, lineOf(call)] })));
}

/**
 * Every result a module seals: for each chain of calls that reaches a noticeHref(path, code, binding, options), where
 * it can lead, under which parameter, with which codes, for whom (as written: "actor.id", "SIGN_IN_NOTICE").
 * `load(specifier)` gives the parsed admin module an "@/…" import names (parseTsx), or null.
 */
export function sealedResults(source, fileName, load = () => null) {
  const file = parseTsx(source, fileName);
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "noticeHref") {
      const [path, code, binding, options] = node.arguments;
      for (const chain of chainsTo(node)) {
        const bindings = valuesOf(binding, load, chain.env);
        found.push({
          // Where it is sealed: the lines of the calls that lead there, then noticeHref's own ("373 → 357 → 310").
          where: [...chain.lines, lineOf(node)].join(" → "),
          paths: valuesOf(path, load, chain.env),
          codes: valuesOf(code, load, chain.env),
          bindings: [...bindings.strings, ...bindings.unknown],
          param: paramOf(options),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The query parameter an expression reads: params.state, query.notice, (await searchParams).state, or a name taken from them. */
function paramRead(expression) {
  const node = unwrap(expression);
  if (!node) return null;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  if (ts.isIdentifier(node)) {
    const declaration = declarationOf(node);
    if (declaration?.kind === "binding") return (declaration.element.propertyName ?? declaration.element.name).getText();
    if (declaration?.kind === "variable") return paramRead(declaration.node.initializer);
  }
  return null;
}

/** Every pageNotice(value, binding) in a page: the parameter it opens and who it is opened for. */
export function pageReads(source, fileName) {
  const file = parseTsx(source, fileName);
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pageNotice") {
      const [value, binding] = node.arguments;
      found.push({ param: paramRead(value), binding: binding?.getText(file) ?? null });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * The codes a source has words for: the keys of its object literals (a page's own table, a notices module's tables)
 * and the codes it compares an opened result's code with (pageNotice(…)?.code === "not_found").
 */
export function wordKeys(source, fileName) {
  const file = parseTsx(source, fileName);
  const keys = new Set();
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) keys.add(property.name.text);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
      const [left, right] = [unwrap(node.left), unwrap(node.right)];
      if (ts.isPropertyAccessExpression(left) && left.name.text === "code" && ts.isStringLiteral(right)) keys.add(right.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return keys;
}

/** The modules a source imports by an @/ path, as admin/src-relative paths without the extension. */
export function localImports(source, fileName) {
  const file = parseTsx(source, fileName);
  return file.statements
    .filter((statement) => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith("@/"))
    .map((statement) => statement.moduleSpecifier.text.slice(2));
}

/** A page's address pattern from its file: app/(control)/users/[id]/page.tsx is "/users/*"; route groups are not in it. */
export function routeOf(pageFile) {
  const segments = pageFile.split("/").slice(1, -1).filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.map((segment) => (/^\[.*\]$/.test(segment) ? "*" : segment)).join("/")}`;
}

/**
 * The page an address pattern leads to (its query and fragment aside): segment by segment, a "*" (a ${…} in the
 * action's address) only where the page has a dynamic segment, a word only where it has that word. Null for none.
 */
export function pageFor(pattern, pages) {
  const wanted = pattern.split(/[?#]/)[0].split("/");
  return pages.find((page) => {
    const have = routeOf(page).split("/");
    return have.length === wanted.length && have.every((segment, index) => segment === wanted[index]);
  }) ?? null;
}

/** Whether a code (a "*" stands for a ${…} in a template) has words among these keys. */
export function hasWords(code, keys) {
  if (!code.includes("*")) return keys.has(code);
  const pattern = new RegExp(`^${code.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9_]+")}$`);
  return [...keys].some((key) => pattern.test(key));
}

// Reading Admin's TSX as the compiler does, for the guard tests. A regular expression cannot find where a JSX tag
// ends: an attribute's {…} may hold "=>" or ">" (onClick={(event) => …}), which ends a naive /<button[^>]*>/ match
// early, so every attribute after it goes unseen. The project's own TypeScript parses the file instead. What a name
// refers to, and the function a name calls (also one imported from another admin module), is shared with
// notice-routes.mjs.
import path from "node:path";
import ts from "typescript";

/** A TSX source as the compiler reads it. */
export function parseTsx(source, fileName = "file.tsx") {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** An expression without the wrapping that does not change its value: (…), as, !, satisfies, await. */
export function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
  return node;
}

export const isFunctionLike = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/**
 * What an identifier refers to, by the scopes around it: a parameter, a prop taken from one ({ label }: …), a local
 * constant, a name taken from one ({ notice } = …), an item of one ([state, action] = …), a function; null for an
 * import or a global.
 */
export function declarationOf(identifier) {
  const name = identifier.text;
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      const index = scope.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name);
      if (index >= 0) return { kind: "parameter", fn: scope, index, node: scope.parameters[index] };
      for (const parameter of scope.parameters) {
        const element = ts.isObjectBindingPattern(parameter.name) ? parameter.name.elements.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === name) : null;
        if (element) return { kind: "prop", fn: scope, parameter, element };
      }
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
        if (ts.isArrayBindingPattern(declaration.name)) {
          const index = declaration.name.elements.findIndex((entry) => ts.isBindingElement(entry) && ts.isIdentifier(entry.name) && entry.name.text === name);
          if (index >= 0) return { kind: "item", node: declaration, index, element: declaration.name.elements[index] };
        }
      }
    }
  }
  return null;
}

/** The function a declaration names (a function, or a constant holding an arrow function), or null. */
export function functionOf(declaration) {
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

/**
 * The function a callee names: one in its own file, or one imported from an admin module `load(specifier, from)` can
 * read (from: the importing file's name, for a relative import).
 */
export function calledFunction(callee, load) {
  const local = functionOf(declarationOf(callee));
  if (local) return local;
  const file = callee.getSourceFile();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    const element = named && ts.isNamedImports(named) ? named.elements.find((entry) => entry.name.text === callee.text) : null;
    if (element) return definedFunction(load(statement.moduleSpecifier.text, file.fileName), (element.propertyName ?? element.name).text);
  }
  return null;
}

/** What a function returns: an arrow's expression, or each return statement's (not those of functions inside it). */
export function returnsOf(fn) {
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

/**
 * load() for the scans: the parsed admin/src module an import names ("@/…", or "./…" and "../…" from the importing
 * file), from a set of sources by their src-relative names; null for a package or a module not in the set.
 */
export function moduleLoader(files) {
  const parsed = new Map();
  return (specifier, from = "") => {
    const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null;
    const name = base === null ? undefined : ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ending) => `${base}${ending}`).find((candidate) => Object.hasOwn(files, candidate));
    if (!name) return null;
    if (!parsed.has(name)) parsed.set(name, parseTsx(files[name], name));
    return parsed.get(name);
  };
}

/**
 * An element's attributes as written: name → the text of its {expression}, the value of its "string", or true, in
 * order, so a later one wins. An object written in place in a spread ({...{ disabled: pending }}) gives its properties
 * the same way; any other spread ({...props}, {...busyProps()}) could set anything, so its text is listed in `spreads`.
 */
function attributesOf(element, file) {
  const attributes = {};
  const spreads = [];
  for (const property of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      const object = unwrap(property.expression);
      if (!ts.isObjectLiteralExpression(object)) {
        spreads.push(property.expression.getText(file));
        continue;
      }
      for (const entry of object.properties) {
        if (ts.isPropertyAssignment(entry) && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))) {
          const value = unwrap(entry.initializer);
          attributes[entry.name.text] = ts.isStringLiteral(value) ? value.text : entry.initializer.getText(file);
        } else if (ts.isShorthandPropertyAssignment(entry)) attributes[entry.name.text] = entry.name.text;
        else spreads.push(entry.getText(file));
      }
      continue;
    }
    const value = property.initializer;
    attributes[property.name.getText(file)] = !value ? true : ts.isJsxExpression(value) ? (value.expression?.getText(file) ?? "") : value.text;
  }
  return { attributes, spreads };
}

const lineOf = (node, file) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/**
 * Every JSX element with one of these tags, with its attributes as written (attributesOf). `spreads` lists the
 * spreads it cannot read, which could add more.
 */
export function jsxElements(source, tags, fileName = "file.tsx") {
  const wanted = new Set(Array.isArray(tags) ? tags : [tags]);
  const file = parseTsx(source, fileName);
  const found = [];
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && wanted.has(node.tagName.getText(file))) {
      found.push({ tag: node.tagName.getText(file), ...attributesOf(node, file), line: lineOf(node, file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Input types whose text is typed in, and so lost when a form is reset. (A password is never kept anyway.) */
const TYPED = new Set(["text", "email", "url", "search", "tel", "number", "date", "datetime-local", "month", "week", "time"]);

/** Packages whose components draw no form field: lucide-react's icons, next/link's links. */
const FIELDLESS = new Set(["lucide-react", "next/link"]);

/** React's types for something drawn: a prop declared with one of these may hold a field its caller writes. */
const DRAWABLE = /\b(ReactNode|ReactElement|ReactPortal|ReactChild|ReactFragment|JSX\.Element|PropsWithChildren|ComponentType|ElementType|FC|FunctionComponent)\b/;

/** An attribute as written: its {expression} (unwrapped), its "string" node, null with no value, undefined if absent. */
function attributeValue(element, name) {
  const property = element.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText() === name);
  if (!property) return undefined;
  if (!property.initializer) return null;
  return ts.isJsxExpression(property.initializer) ? unwrap(property.initializer.expression) ?? null : property.initializer;
}

/** Whether an action={…} or formAction={…} is a function, which React runs itself; a string is an address to go to. */
function runsItself(value) {
  if (!value) return false;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isTemplateExpression(value)) return false;
  return !(value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "undefined"));
}

/**
 * Whether a submit handler takes the submit over: its first statement prevents the default, so React neither runs the
 * form's action nor resets the form (a handler that may return first, or prevents it only sometimes, does not). Read
 * through a local function's name and through a call that returns the handler, as keepTyped(action) does.
 */
function takesOver(handler, load, depth = 0) {
  const node = unwrap(handler);
  if (!node || depth > 4) return false;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    const first = ts.isBlock(node.body) ? node.body.statements[0] : null;
    const expression = ts.isBlock(node.body) ? (first && ts.isExpressionStatement(first) ? first.expression : null) : node.body;
    return Boolean(expression) && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "preventDefault";
  }
  if (ts.isIdentifier(node)) {
    const fn = functionOf(declarationOf(node));
    return Boolean(fn) && takesOver(fn, load, depth + 1);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const fn = calledFunction(node.expression, load);
    const handlers = fn ? returnsOf(fn) : [];
    return handlers.length > 0 && handlers.every((returned) => takesOver(returned, load, depth + 1));
  }
  return false;
}

/** useActionState's state when a form's action is its dispatcher (const [state, action] = useActionState(…)), else null. */
function answerOf(action) {
  const declaration = action && ts.isIdentifier(action) ? declarationOf(action) : null;
  if (declaration?.kind !== "item" || declaration.index !== 1) return null;
  const call = unwrap(declaration.node.initializer);
  const callee = call && ts.isCallExpression(call) ? call.expression : null;
  const name = !callee ? null : ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  const state = name === "useActionState" ? declaration.node.name.elements[0] : null;
  return state && ts.isBindingElement(state) && ts.isIdentifier(state.name) ? { state, call } : null;
}

/** Whether an expression reads useActionState's state, as defaultValue={state?.username ?? ""} does. */
function readsAnswer(expression, answer) {
  let reads = false;
  const look = (node) => {
    if (reads) return;
    if (ts.isIdentifier(node) && declarationOf(node)?.element === answer.state) reads = true;
    else ts.forEachChild(node, look);
  };
  if (expression) look(expression);
  return reads;
}

/** What a JSX {…} draws: the branches of ?:, the right of &&, both sides of || and ??, a list's items, a map's returns. */
function leavesOf(expression, out = []) {
  const node = unwrap(expression);
  if (!node) return out;
  if (ts.isConditionalExpression(node)) [node.whenTrue, node.whenFalse].forEach((branch) => leavesOf(branch, out));
  else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) leavesOf(node.right, out);
  else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) [node.left, node.right].forEach((side) => leavesOf(side, out));
  else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((element) => leavesOf(element, out));
  else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    // items.map((item) => …): what the callback returns is drawn; items.map(renderRow): renderRow is; and so may the
    // owner of the method be (props.render(), nodes.concat(…)).
    out.push(node.expression.expression);
    for (const argument of node.arguments.map(unwrap)) {
      if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) returnsOf(argument).forEach((returned) => leavesOf(returned, out));
      else if (argument && ts.isIdentifier(argument)) out.push(argument);
    }
  } else out.push(node);
  return out;
}

/** The name a drawn value is read from: props in props.children, labels in labels[kind]; null for anything else. */
function rootName(node) {
  const value = unwrap(node);
  if (!value) return null;
  if (ts.isIdentifier(value)) return value;
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) return rootName(value.expression);
  return null;
}

/** A type declared in the file under this name (type X = …, interface X { … }), or null. */
function localType(name, file) {
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) return statement.type;
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) return statement;
  }
  return null;
}

/** A type, with a reference to a type of the same file replaced by what it says. */
function resolved(type) {
  return type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) ? (localType(type.typeName.text, type.getSourceFile()) ?? type) : type;
}

/**
 * Whether a parameter or prop may hold something drawn: its declared type (as written, or as a type of the same file
 * says) names one of React's, or the scan cannot find its type.
 */
function mayHoldJsx(declaration) {
  let type = resolved(declaration.kind === "parameter" ? declaration.node.type : declaration.parameter.type);
  if (type && declaration.kind === "prop") {
    const name = (declaration.element.propertyName ?? declaration.element.name).getText();
    const members = ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type) ? type.members : [];
    type = members.find((member) => member.name?.getText() === name)?.type ?? null;
  }
  return !type || DRAWABLE.test(type.getText()) || DRAWABLE.test(resolved(type).getText());
}

/** The module an imported name comes from ("lucide-react", "./reason-field"), or null when it is not imported. */
function importedFrom(identifier) {
  for (const statement of identifier.getSourceFile().statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    if (clause?.name?.text === identifier.text) return statement.moduleSpecifier.text;
    if (named && ts.isNamespaceImport(named) && named.name.text === identifier.text) return statement.moduleSpecifier.text;
    if (named && ts.isNamedImports(named) && named.elements.some((element) => element.name.text === identifier.text)) return statement.moduleSpecifier.text;
  }
  return null;
}

/** A tag of the platform's own (input, label, svg:path) rather than a component (Reason, Icons.Send). */
const builtIn = (tag) => (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) || ts.isJsxNamespacedName(tag);

/**
 * The fields a form draws that lose what was typed when React resets it, read from the form's own JSX and from what it
 * draws: a component or a function of the same file or of another admin module (through `load`), a local constant,
 * what a component is given (its attributes, its children). A field keeps its text when it takes none (a choice, a
 * password, a hidden input), is read-only or hidden, is controlled (React writes its value where reset() goes back
 * to), or its defaultValue reads useActionState's state (the answer gives it back). `unread` names what the scan
 * cannot see into: a component it cannot find, unless it comes from a FIELDLESS package, and a prop of the component
 * around the form that may hold something drawn (its children, a render prop): that component's caller writes it.
 */
function drawnFields(form, load, answer) {
  const typed = [];
  const unread = new Set();
  const read = new Set();
  // The components around the form (also one wrapped in forwardRef or memo), not a callback such as a map's: what
  // they are given is written elsewhere.
  const around = new Set();
  for (let node = form.parent; node; node = node.parent) {
    const call = node.parent && ts.isCallExpression(node.parent) && node.parent.arguments.includes(node) ? node.parent : null;
    if (isFunctionLike(node) && (!call || /(^|\.)(forwardRef|memo)$/.test(call.expression.getText()))) around.add(node);
  }
  const once = (node, then) => {
    if (read.has(node)) return;
    read.add(node);
    then(node);
  };
  const field = (element) => {
    const tag = element.tagName.getText();
    if (tag !== "input" && tag !== "textarea") return;
    const { attributes } = attributesOf(element, element.getSourceFile());
    if (tag === "input" && !TYPED.has(attributes.type === undefined ? "text" : attributes.type)) return;
    if (attributes.readOnly || attributes.hidden || attributes.value !== undefined) return;
    if (answer && readsAnswer(attributeValue(element, "defaultValue"), answer)) return;
    typed.push(attributes.name ?? tag);
  };
  const named = (identifier) => {
    const fn = calledFunction(identifier, load);
    if (fn) return once(fn, walk);
    const declaration = declarationOf(identifier);
    if (declaration?.kind === "variable" && declaration.node.initializer) {
      once(declaration.node, () => {
        walk(declaration.node.initializer);
        drawn(declaration.node.initializer);
      });
    } else if ((declaration?.kind === "parameter" || declaration?.kind === "prop") && around.has(declaration.fn) && mayHoldJsx(declaration)) {
      unread.add(`{${identifier.text}}`);
    }
  };
  // A name drawn, or called to draw: renderReason(), fields(state), props.children, labels[kind].
  const drawn = (expression) => {
    for (const leaf of leavesOf(expression)) {
      const root = rootName(ts.isCallExpression(leaf) ? leaf.expression : leaf);
      if (root) named(root);
    }
  };
  const component = (element) => {
    const tag = element.tagName;
    const fn = ts.isIdentifier(tag) ? calledFunction(tag, load) : null;
    const root = rootName(tag);
    if (fn) once(fn, walk);
    else if (!root || !FIELDLESS.has(importedFrom(root))) unread.add(`<${tag.getText()}>`);
    // What it is given, it may draw.
    for (const property of element.attributes.properties) {
      const given = ts.isJsxSpreadAttribute(property) ? property.expression : property.initializer && ts.isJsxExpression(property.initializer) ? property.initializer.expression : null;
      if (given) drawn(given);
    }
  };
  const walk = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (builtIn(node.tagName)) field(node);
      else component(node);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) drawn(node.expression);
    ts.forEachChild(node, walk);
  };
  form.children.forEach(walk);
  return { typed, unread: [...unread] };
}

/**
 * The forms React resets after their action, with the fields in them that lose what was typed (drawnFields). React runs
 * a form's action itself, and then resets the form, when the action or a button's formAction is a function: a Server
 * Action (also chosen, bound or passed in) or a useActionState dispatcher. Unless the form's onSubmit takes the submit
 * over first (takesOver), as keepTyped does, a refusal empties what was typed (BUGS.md 63). `action` says which, as
 * written, or useActionState(<its action>). `load(specifier, from)` gives the parsed admin module an import names.
 */
export function resetForms(source, fileName = "file.tsx", load = () => null) {
  const file = parseTsx(source, fileName);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "form") {
      const action = attributeValue(node.openingElement, "action");
      const pressed = [];
      const buttons = (child) => {
        if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && ["button", "input"].includes(child.tagName.getText(file))) pressed.push(attributeValue(child, "formAction"));
        ts.forEachChild(child, buttons);
      };
      node.children.forEach(buttons);
      const actions = [action, ...pressed].filter(runsItself);
      const onSubmit = attributeValue(node.openingElement, "onSubmit");
      if (actions.length && !(onSubmit && takesOver(onSubmit, load))) {
        const answer = answerOf(action);
        const { typed, unread } = drawnFields(node, load, answer);
        const said = actions.map((value) => (value === action && answer ? `useActionState(${answer.call.arguments[0]?.getText(file) ?? ""})` : value.getText(file)));
        found.push({ action: said.join(" or "), typed, unread, line: lineOf(node, file) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Reading Admin's TSX as the compiler does, for the guard tests. A regular expression cannot find where a JSX tag
// ends: an attribute's {…} may hold "=>" or ">" (onClick={(event) => …}), which ends a naive /<button[^>]*>/ match
// early, so every attribute after it goes unseen. The project's own TypeScript parses the file instead.
import ts from "typescript";

/** A TSX source as the compiler reads it. */
export function parseTsx(source, fileName = "file.tsx") {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** An element's attributes as written: name → the text of its {expression}, the value of its "string", or true. */
function attributesOf(element, file) {
  const attributes = {};
  let spread = false;
  for (const property of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      spread = true;
      continue;
    }
    const value = property.initializer;
    attributes[property.name.getText(file)] = !value ? true : ts.isJsxExpression(value) ? (value.expression?.getText(file) ?? "") : value.text;
  }
  return { attributes, spread };
}

const lineOf = (node, file) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/**
 * Every JSX element with one of these tags, with its attributes as written (attributesOf). `spread` says whether
 * {...props} could add more.
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

/**
 * The forms whose action is a Server Action itself (a name imported from an actions module, not a useActionState
 * dispatcher), with the names of the fields in them that take typed text. React resets such a form after its action,
 * so a refusal that redirects loses what was typed (BUGS.md 63).
 */
export function serverActionForms(source, fileName = "file.tsx") {
  const file = parseTsx(source, fileName);
  const actions = new Set();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/(^|\/)actions$/.test(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const element of named.elements) actions.add(element.name.text);
  }
  /** The imported Server Actions an action={…} names, also inside a choice (suspended ? unsuspendAccount : suspendAccount). */
  const named = (expression) => {
    const names = [];
    const look = (node) => {
      if (ts.isIdentifier(node) && actions.has(node.text)) names.push(node.text);
      ts.forEachChild(node, look);
    };
    if (expression) look(expression);
    return names;
  };
  const found = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "form") {
      const attribute = node.openingElement.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(file) === "action");
      const value = attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : null;
      const action = named(value).join(" or ");
      if (action) {
        const typed = [];
        const fields = (child) => {
          if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
            const tag = child.tagName.getText(file);
            const { attributes } = attributesOf(child, file);
            const type = attributes.type === undefined ? "text" : attributes.type;
            if (tag === "textarea" || (tag === "input" && TYPED.has(type) && !attributes.readOnly && !attributes.hidden)) typed.push(attributes.name ?? tag);
          }
          ts.forEachChild(child, fields);
        };
        node.children.forEach(fields);
        found.push({ action, typed, line: lineOf(node, file) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

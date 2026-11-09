// VS Code の色の既定値（registerColor で登録されたもの）を JSON にする。
// テーマが決めていない色を、VS Code と同じ値で埋めるために使う。
//
// 使い方: node scripts/generate-vscode-color-defaults.mjs <VS Code のソースのファイル...>
//   対象: src/vs/platform/theme/common/colors/*.ts、src/vs/workbench/common/theme.ts、extensions/git/package.json
// 出力: src/infrastructure/theme/vscodeColorDefaults.json（VS Code は MIT。ライセンスは同じフォルダの LICENSE.txt）
//
// 値の形: "#rrggbb" | 色の名前（別の色を指す） | { op, ... }（VS Code の ColorTransform と同じ） | null
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const files = process.argv.slice(2);
const output = new URL("../src/infrastructure/theme/vscodeColorDefaults.json", import.meta.url);

const NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  blue: "#0000ff",
  green: "#00ff00",
  cyan: "#00ffff",
  lightgrey: "#d3d3d3",
  transparent: "#00000000",
};
const TRANSFORMS = {
  darken: ["value", "factor"],
  lighten: ["value", "factor"],
  transparent: ["value", "factor"],
  withOpacity: ["value", "opacity"],
  opaque: ["value", "background"],
  ifDefinedThenElse: ["if", "then", "else"],
  lessProminent: ["value", "background", "factor", "transparency"],
};
const OP_NAMES = {
  darken: "darken",
  lighten: "lighten",
  transparent: "transparent",
  withOpacity: "opacity",
  opaque: "opaque",
  ifDefinedThenElse: "ifDefinedThenElse",
  lessProminent: "lessProminent",
  oneOf: "oneOf",
};

const hex = (n) => n.toString(16).padStart(2, "0");
const constants = new Map(); // 変数名 → 色の名前
const locals = new Map(); // registerColor でない定数（const defaultInsertColor = ...）の式
const pending = []; // [色の名前, 既定値の式]
const unresolved = new Set();

for (const file of files.filter((f) => f.endsWith(".ts"))) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText() === "registerColor") {
      const [id, defaults] = node.arguments;
      if (ts.isStringLiteral(id)) {
        pending.push([id.text, defaults]);
        const declaration = node.parent;
        if (ts.isVariableDeclaration(declaration)) constants.set(declaration.name.getText(), id.text);
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      locals.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function toValue(node) {
  if (!node || node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node)) return -toValue(node.operand);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return toValue(node.expression);
  if (ts.isIdentifier(node)) {
    const id = constants.get(node.text);
    if (id) return id;
    if (locals.has(node.text)) return toValue(locals.get(node.text));
    unresolved.add(node.text);
    return null;
  }
  // { op: ColorTransformType.Mix, color, with, ratio } のように変換を直接書いたもの
  if (ts.isObjectLiteralExpression(node)) {
    const transform = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name.getText();
      transform[key] =
        key === "op" ? property.initializer.getText().replace("ColorTransformType.", "").toLowerCase() : toValue(property.initializer);
    }
    if (transform.op === "mix") return transform;
  }
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "Color") {
    return NAMED_COLORS[node.name.text] ?? null;
  }
  if (ts.isCallExpression(node)) {
    const name = node.expression.getText();
    if (name === "Color.fromHex") return toValue(node.arguments[0]);
    // Color.white.transparent(0.1) のような、色の値に直接かけたもの
    if (ts.isPropertyAccessExpression(node.expression) && ["transparent", "lighten", "darken"].includes(node.expression.name.text)) {
      return { op: node.expression.name.text, value: toValue(node.expression.expression), factor: toValue(node.arguments[0]) };
    }
    if (name === "oneOf") return { op: "oneOf", values: node.arguments.map(toValue) };
    if (TRANSFORMS[name]) {
      const transform = { op: OP_NAMES[name] };
      TRANSFORMS[name].forEach((key, index) => (transform[key] = toValue(node.arguments[index])));
      return transform;
    }
  }
  if (ts.isNewExpression(node) && node.expression.getText() === "Color") {
    const rgba = node.arguments?.[0];
    if (rgba && ts.isNewExpression(rgba) && rgba.expression.getText() === "RGBA") {
      const [r, g, b, a = 1] = rgba.arguments.map(toValue);
      return `#${hex(r)}${hex(g)}${hex(b)}${a === 1 ? "" : hex(Math.round(a * 255))}`;
    }
  }
  unresolved.add(node.getText().slice(0, 60));
  return null;
}

const THEME_KINDS = ["dark", "light", "hcDark", "hcLight"];
const defaults = {};
for (const [id, node] of pending) {
  const isTransform = node && ts.isObjectLiteralExpression(node) && node.properties.some((p) => p.name?.getText() === "op");
  if (node && ts.isObjectLiteralExpression(node) && !isTransform) {
    const entry = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) entry[property.name.getText()] = toValue(property.initializer);
    }
    defaults[id] = Object.fromEntries(THEME_KINDS.map((kind) => [kind, entry[kind] ?? null]));
  } else {
    const value = toValue(node);
    defaults[id] = Object.fromEntries(THEME_KINDS.map((kind) => [kind, value]));
  }
}

// Git の拡張機能が登録する色（package.json の contributes.colors）
for (const file of files.filter((f) => f.endsWith(".json"))) {
  for (const color of JSON.parse(readFileSync(file, "utf8")).contributes?.colors ?? []) {
    const { light, dark, highContrast, highContrastLight } = color.defaults;
    defaults[color.id] = { dark, light, hcDark: highContrast, hcLight: highContrastLight ?? light };
  }
}

const sorted = Object.fromEntries(Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(output, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${Object.keys(sorted).length} colors`);
if (unresolved.size) console.log("unresolved:", [...unresolved].join(", "));

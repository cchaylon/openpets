/**
 * Static spritesheet contract shared by pet import, validation and rendering.
 * Copied from the OpenPets pet format so packages authored for it stay compatible.
 */
export type PetSpritesheetPath = "spritesheet.webp" | "spritesheet.svg";

export interface PetSpritesheetSpec {
  readonly spritesheetPath: PetSpritesheetPath;
  readonly width: 1536;
  readonly height: 1872 | 2288;
  readonly version: 1 | 2;
}

export const maxSvgSpritesheetBytes = 8 * 1024 * 1024;
const maxElements = 20_000;
const maxDepth = 64;
const maxAttributeLength = 256 * 1024;
const svgNamespace = "http://www.w3.org/2000/svg";
const elements = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "title", "desc",
]);
const attributes = new Set([
  "id", "xmlns", "version", "width", "height", "viewBox", "preserveAspectRatio",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "d", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "clipPathUnits",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity",
  "vector-effect", "shape-rendering", "color",
]);

export function validatePetSpritesheetPath(value: unknown): PetSpritesheetPath {
  if (value !== "spritesheet.webp" && value !== "spritesheet.svg") {
    throw new Error("宠物 spritesheetPath 必须是 spritesheet.webp 或 spritesheet.svg。");
  }
  return value;
}

/** Resolve canonical asset selection and intrinsic atlas bounds from pet.json. */
export function getPetSpritesheetSpec(metadata: unknown): PetSpritesheetSpec {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("宠物元数据必须是对象。");
  }
  const record = metadata as Record<string, unknown>;
  const spritesheetPath = validatePetSpritesheetPath(record.spritesheetPath);
  const hasVersion = Object.hasOwn(record, "spriteVersionNumber");
  if (hasVersion && record.spriteVersionNumber !== 2) {
    throw new Error("spriteVersionNumber 只能是 2。");
  }
  return {
    spritesheetPath,
    width: 1536,
    height: hasVersion ? 2288 : 1872,
    version: hasVersion ? 2 : 1,
  };
}

export function petSpritesheetMimeType(path: string): "image/svg+xml" | "image/webp" {
  return path.endsWith(".svg") ? "image/svg+xml" : "image/webp";
}

export function assertPetPackageFiles(files: Iterable<string>, selected?: PetSpritesheetPath): void {
  const names = new Set(files);
  const sprite = selected ?? (names.has("spritesheet.svg") ? "spritesheet.svg" : "spritesheet.webp");
  if (names.size !== 2 || !names.has("pet.json") || !names.has(sprite)) {
    throw new Error("宠物包必须包含 pet.json 且只能有一张匹配的 spritesheet.webp 或 spritesheet.svg。");
  }
}

/**
 * Deliberately accepts a small XML/vector profile, not arbitrary SVG. No CSS,
 * entities, namespaces other than SVG, reusable subtrees, raster, or active
 * elements are accepted. References can only target reference-free gradients
 * or clip paths, preventing recursive/expanding render graphs.
 */
export function validateSvgSpritesheet(bytes: Uint8Array, width: number, height: number): void {
  if (bytes.byteLength === 0 || bytes.byteLength > maxSvgSpritesheetBytes) {
    throw new Error("SVG 精灵图为空或超过 8 MiB。");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) {
    throw new Error("SVG 包含非法字符。");
  }

  const xml = source.replace(
    /^\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/iu,
    "",
  );
  const stack: string[] = [];
  const ids = new Map<string, string>();
  const references: { id: string; attribute: string }[] = [];
  let position = 0;
  let count = 0;
  let rootClosed = false;
  while (position < xml.length) {
    const next = xml.indexOf("<", position);
    const text = xml.slice(position, next < 0 ? xml.length : next);
    if (text.includes("&")) {
      throw new Error("SVG 不允许实体引用。");
    }
    const parentElement = stack.at(-1);
    if (text.trim() && parentElement !== "title" && parentElement !== "desc") {
      throw new Error("SVG 不允许文本图形。");
    }
    if (next < 0) {
      break;
    }

    if (xml.startsWith("<!--", next)) {
      const commentEnd = xml.indexOf("-->", next + 4);
      if (commentEnd < 0 || xml.slice(next + 4, commentEnd).includes("--")) {
        throw new Error("SVG 注释格式非法。");
      }
      position = commentEnd + 3;
      continue;
    }

    const end = xml.indexOf(">", next);
    if (end < 0) {
      throw new Error("SVG 标签未闭合。");
    }
    const tag = xml.slice(next + 1, end);
    if (/[&!?]/u.test(tag)) {
      throw new Error("SVG 不允许实体、声明或处理指令。");
    }
    position = end + 1;

    if (tag.startsWith("/")) {
      const closingTag = /^\/([A-Za-z]+)[\t\n\r ]*$/u.exec(tag);
      if (!closingTag) {
        throw new Error("SVG 闭合标签非法。");
      }
      const name = closingTag[1];
      if (!stack.length || name !== stack.pop()) {
        throw new Error("SVG 闭合标签不匹配。");
      }
      if (!stack.length) {
        rootClosed = true;
      }
      continue;
    }

    const match = /^([A-Za-z]+)([\s\S]*?)(\/?)$/u.exec(tag);
    if (!match) {
      throw new Error("SVG 标签非法。");
    }
    const [, name, rawAttributes, selfClosing] = match;
    if (!name || !elements.has(name) || rootClosed || (count > 0 && name === "svg")) {
      throw new Error("SVG 元素不受支持。");
    }
    if (count === 0 && name !== "svg") {
      throw new Error("SVG 必须以 svg 为根。");
    }
    count += 1;
    if (count > maxElements || stack.length >= maxDepth) {
      throw new Error("SVG 结构超出复杂度限制。");
    }

    const attrs = parseAttributes(rawAttributes ?? "");
    if (name === "svg") {
      const viewBox = attrs.get("viewBox")?.trim().split(/[\s,]+/u).map(Number).join(" ");
      if (
        attrs.get("xmlns") !== svgNamespace
        || parseDimension(attrs.get("width")) !== width
        || parseDimension(attrs.get("height")) !== height
        || viewBox !== `0 0 ${width} ${height}`
      ) {
        throw new Error(`SVG 精灵图需要 width="${width}"、height="${height}" 和 viewBox="0 0 ${width} ${height}"。`);
      }
    } else if (attrs.has("xmlns") || attrs.has("viewBox")) {
      throw new Error("SVG 不允许嵌套命名空间或视口。");
    }
    const id = attrs.get("id");
    if (id) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(id) || ids.has(id)) {
        throw new Error("SVG id 非法或重复。");
      }
      ids.set(id, name);
    }

    for (const [attribute, value] of attrs) {
      if (!attributes.has(attribute) || value.length > maxAttributeLength || /[<>\\]/u.test(value)) {
        throw new Error("SVG 属性不受支持。");
      }
      if (attribute === "xmlns") {
        continue;
      }

      if (/url\s*\(/iu.test(value)) {
        const reference = /^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$/u.exec(value);
        const referenceId = reference?.[1];
        const isReferenceAttribute = ["fill", "stroke", "clip-path"].includes(attribute);
        const isInsideDefinition = stack.some((ancestor) => (
          ["defs", "clipPath", "linearGradient", "radialGradient"].includes(ancestor)
        ));
        const isDefinition = ["clipPath", "linearGradient", "radialGradient"].includes(name);
        if (!referenceId || !isReferenceAttribute || isInsideDefinition || isDefinition) {
          throw new Error("SVG 引用必须指向本文件且不能递归。");
        }
        references.push({ id: referenceId, attribute });
      } else {
        const supportsFunctionalValue = [
          "transform", "gradientTransform", "fill", "stroke", "stop-color", "color",
        ].includes(attribute);
        if (/[():;@]/u.test(value) && !supportsFunctionalValue) {
          throw new Error("SVG 属性值不受支持。");
        }
      }
    }

    if (!selfClosing) {
      stack.push(name);
    } else if (name === "svg") {
      rootClosed = true;
    }
  }

  if (!count || stack.length || !rootClosed) {
    throw new Error("SVG 文档不完整。");
  }
  for (const reference of references) {
    const target = ids.get(reference.id);
    const allowedTargets = reference.attribute === "clip-path"
      ? ["clipPath"]
      : ["linearGradient", "radialGradient"];
    if (!target || !allowedTargets.includes(target)) {
      throw new Error("SVG 引用目标非法。");
    }
  }
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gyu;
  let position = 0;
  while (source.slice(position).trim()) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match || !match[1] || attrs.has(match[1])) {
      throw new Error("SVG 属性格式非法或重复。");
    }
    attrs.set(match[1], match[2] ?? match[3] ?? "");
    position = pattern.lastIndex;
  }
  return attrs;
}

function parseDimension(value: string | undefined): number {
  if (!value || !/^\d+(?:\.\d+)?(?:px)?$/u.test(value)) {
    return Number.NaN;
  }
  return Number(value.replace(/px$/u, ""));
}

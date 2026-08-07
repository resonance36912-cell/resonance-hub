/**
 * Tiny schema.org shape validator.
 *
 * Purpose: catch JSON-LD that Google's Rich Results test would reject —
 * missing required properties, wrongly typed values (number where a string
 * is expected, relative URL where an absolute one is required), unexpected
 * @type values, and stray properties that indicate a copy/paste mistake.
 *
 * Deliberately dependency-free and structural: it validates the shape we
 * promise crawlers, not the entire schema.org vocabulary.
 */

export type SchemaIssue = {
  /** Dotted path to the offending value, e.g. `itemListElement[1].item.url`. */
  path: string;
  message: string;
};

type Primitive = "string" | "number" | "boolean";

export type FieldSpec = {
  /** Expected primitive type of the value. */
  type: Primitive;
  /** Required properties must exist and be non-empty. */
  required?: boolean;
  /** Must be an absolute https:// URL. */
  absoluteUrl?: boolean;
  /** Value must be one of these exact strings. */
  oneOf?: string[];
  /** Numbers must be integers >= 1. */
  positiveInt?: boolean;
  /** Minimum trimmed length for strings. */
  minLength?: number;
};

export type ObjectSpec = {
  /** Expected `@type` value(s) for this node. */
  atType: string | string[];
  /** `@context` requirement — only the root node carries one. */
  atContext?: string;
  fields: Record<string, FieldSpec>;
  /** Properties beyond `fields` + `@type`/`@context` are reported. */
  allowUnknown?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateField(
  path: string,
  key: string,
  value: unknown,
  spec: FieldSpec,
  issues: SchemaIssue[],
): void {
  const at = path ? `${path}.${key}` : key;

  if (value === undefined || value === null) {
    if (spec.required) issues.push({ path: at, message: `missing required property "${key}"` });
    return;
  }

  if (typeOf(value) !== spec.type) {
    issues.push({
      path: at,
      message: `expected ${spec.type}, got ${typeOf(value)}`,
    });
    return;
  }

  if (spec.type === "string") {
    const str = value as string;
    if (spec.required && str.trim().length === 0) {
      issues.push({ path: at, message: "required string is empty" });
      return;
    }
    if (spec.minLength !== undefined && str.trim().length < spec.minLength) {
      issues.push({
        path: at,
        message: `string shorter than ${spec.minLength} chars (got ${str.trim().length})`,
      });
    }
    if (spec.absoluteUrl && !/^https:\/\/[^\s]+$/.test(str)) {
      issues.push({ path: at, message: `expected absolute https URL, got "${str}"` });
    }
    if (spec.oneOf && !spec.oneOf.includes(str)) {
      issues.push({
        path: at,
        message: `value "${str}" not one of ${spec.oneOf.join(", ")}`,
      });
    }
  }

  if (spec.type === "number" && spec.positiveInt) {
    const num = value as number;
    if (!Number.isInteger(num) || num < 1) {
      issues.push({ path: at, message: `expected positive integer, got ${num}` });
    }
  }
}

/** Validate a single JSON-LD node against an ObjectSpec. */
export function validateNode(
  node: unknown,
  spec: ObjectSpec,
  path = "",
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  if (!isPlainObject(node)) {
    return [{ path: path || "$", message: `expected object, got ${typeOf(node)}` }];
  }

  const expected = Array.isArray(spec.atType) ? spec.atType : [spec.atType];
  const atType = node["@type"];
  if (typeof atType !== "string") {
    issues.push({
      path: path ? `${path}.@type` : "@type",
      message: `missing or non-string @type (got ${typeOf(atType)})`,
    });
  } else if (!expected.includes(atType)) {
    issues.push({
      path: path ? `${path}.@type` : "@type",
      message: `@type "${atType}" not one of ${expected.join(", ")}`,
    });
  }

  if (spec.atContext !== undefined) {
    if (node["@context"] !== spec.atContext) {
      issues.push({
        path: path ? `${path}.@context` : "@context",
        message: `expected @context "${spec.atContext}", got ${JSON.stringify(node["@context"])}`,
      });
    }
  }

  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    validateField(path, key, node[key], fieldSpec, issues);
  }

  if (!spec.allowUnknown) {
    const known = new Set([...Object.keys(spec.fields), "@type", "@context"]);
    for (const key of Object.keys(node)) {
      if (!known.has(key)) {
        issues.push({
          path: path ? `${path}.${key}` : key,
          message: `unexpected property "${key}"`,
        });
      }
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Specs for the not-found page's structured data
 * ------------------------------------------------------------------ */

export const SOFTWARE_APPLICATION_SPEC: ObjectSpec = {
  atType: "SoftwareApplication",
  fields: {
    name: { type: "string", required: true, minLength: 2 },
    description: { type: "string", required: true, minLength: 10 },
    url: { type: "string", required: true, absoluteUrl: true },
    applicationCategory: { type: "string", required: true, minLength: 3 },
  },
};

export const LIST_ITEM_SPEC: ObjectSpec = {
  atType: "ListItem",
  fields: {
    position: { type: "number", required: true, positiveInt: true },
    // `item` is validated separately as a nested node.
    item: { type: "object" as Primitive, required: true },
  },
};

export const ITEM_LIST_SPEC: ObjectSpec = {
  atType: "ItemList",
  atContext: "https://schema.org",
  fields: {
    name: { type: "string", required: true, minLength: 5 },
    numberOfItems: { type: "number", required: true, positiveInt: true },
    itemListOrder: {
      type: "string",
      required: true,
      oneOf: [
        "https://schema.org/ItemListOrderAscending",
        "https://schema.org/ItemListOrderDescending",
        "https://schema.org/ItemListUnordered",
      ],
    },
    itemListElement: { type: "array" as Primitive, required: true },
  },
};

/**
 * Full validation of an ItemList-of-SoftwareApplication payload:
 * root shape, element array, each ListItem, each nested item, and
 * numberOfItems/position consistency.
 */
export function validateItemList(payload: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  if (!isPlainObject(payload)) {
    return [{ path: "$", message: `expected object, got ${typeOf(payload)}` }];
  }

  // Root: skip the array/object fields the generic validator can't type.
  const rootFields = { ...ITEM_LIST_SPEC.fields };
  delete rootFields.itemListElement;
  issues.push(
    ...validateNode(payload, { ...ITEM_LIST_SPEC, fields: rootFields, allowUnknown: true }),
  );

  const elements = payload["itemListElement"];
  if (!Array.isArray(elements)) {
    issues.push({
      path: "itemListElement",
      message: `expected array, got ${typeOf(elements)}`,
    });
    return issues;
  }
  if (elements.length === 0) {
    issues.push({ path: "itemListElement", message: "itemListElement is empty" });
  }

  const count = payload["numberOfItems"];
  if (typeof count === "number" && count !== elements.length) {
    issues.push({
      path: "numberOfItems",
      message: `numberOfItems ${count} does not match ${elements.length} elements`,
    });
  }

  const seenPositions = new Set<number>();
  const seenUrls = new Set<string>();

  elements.forEach((element, index) => {
    const path = `itemListElement[${index}]`;
    const listItemFields = { ...LIST_ITEM_SPEC.fields };
    delete listItemFields.item;
    issues.push(
      ...validateNode(element, { ...LIST_ITEM_SPEC, fields: listItemFields, allowUnknown: true }),
    );

    if (!isPlainObject(element)) return;

    const position = element["position"];
    if (typeof position === "number") {
      if (position !== index + 1) {
        issues.push({
          path: `${path}.position`,
          message: `position ${position} does not match array index ${index + 1}`,
        });
      }
      if (seenPositions.has(position)) {
        issues.push({ path: `${path}.position`, message: `duplicate position ${position}` });
      }
      seenPositions.add(position);
    }

    const item = element["item"];
    if (item === undefined) {
      issues.push({ path: `${path}.item`, message: 'missing required property "item"' });
      return;
    }
    issues.push(...validateNode(item, SOFTWARE_APPLICATION_SPEC, `${path}.item`));

    if (isPlainObject(item) && typeof item["url"] === "string") {
      const url = item["url"];
      if (seenUrls.has(url)) {
        issues.push({ path: `${path}.item.url`, message: `duplicate item url ${url}` });
      }
      seenUrls.add(url);
    }
  });

  return issues;
}

/** Human-readable issue report for test failure messages. */
export function formatIssues(issues: SchemaIssue[]): string {
  if (issues.length === 0) return "no issues";
  return issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
}

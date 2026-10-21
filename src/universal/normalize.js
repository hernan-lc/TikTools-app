import mappings from "./schemas/mappings.schema.json" with { type: "json" };
function fields(mapping, input, index) {
  const result = {};
  for (const [key, rule] of Object.entries(mapping)) {
    const value = input?.[rule[index]];
    if (rule[2] === "boolean")
      result[key] = typeof value === "boolean" ? value : rule[3];
    else if (rule[2] === "counter")
      result[key] =
        typeof value === "string" && /^[0-9]{1,20}$/.test(value)
          ? value
          : Number.isSafeInteger(value) && value >= 0
            ? String(value)
            : rule[3];
    else result[key] = typeof value === "string" ? value : rule[3];
  }
  return result;
}
export function normalizeData(type, input, user, index) {
  const mapping = mappings.definitions[type];
  if (!mapping) return JSON.parse(JSON.stringify(input));
  return {
    ...fields(mapping, input, index),
    user: fields(mappings.user, user, index),
  };
}

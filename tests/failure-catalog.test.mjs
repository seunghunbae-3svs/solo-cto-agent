import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import Ajv from "ajv";

describe("failure-catalog.json", () => {
  it("matches schema", () => {
    const catalogPath = path.join(process.cwd(), "failure-catalog.json");
    const schemaPath = path.join(process.cwd(), "failure-catalog.schema.json");

    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const valid = validate(catalog);

    if (!valid) {
      const message = validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; ");
      throw new Error(message);
    }

    expect(valid).toBe(true);
  });
});

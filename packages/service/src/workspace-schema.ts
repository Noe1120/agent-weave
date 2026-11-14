import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schema from "../../contracts/src/generated/workspace.schema.json" with { type: "json" };
import type { WorkspaceCommand } from "../../contracts/src/generated/workspace.ts";
export type { WorkspaceCommand };
const ajv = new Ajv2020({ strict: true, allErrors: true });
(addFormatsModule as unknown as (a: Ajv2020) => void)(ajv);
const validator = ajv.compile(schema);
export function validateCommand(value: unknown): value is WorkspaceCommand {
  return validator(value) === true;
}

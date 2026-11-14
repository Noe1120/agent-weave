import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import core from "./generated/core.schema.json" with { type: "json" };
import resource from "./generated/resources.schema.json" with { type: "json" };
import bindings from "./generated/transport-bindings.json" with { type: "json" };
import mapping from "./generated/error-mapping.json" with { type: "json" };
import type { CoreWire } from "./generated/core.ts";
export type { CoreWire };
export type CoreRequest = Extract<CoreWire, { kind: Operation }>;
export type CoreResult = Extract<CoreWire, { kind: "service_result" }>;
export type CoreError = Extract<CoreWire, { kind: "service_error" }>;
export type Receipt = Extract<CoreResult, { operation: "read_action" }>["data"];
export type WaitRecord = Extract<
  CoreResult,
  { operation: "read_wait" }
>["data"];
export type PlanProgress = Extract<
  CoreResult,
  { operation: "get_plan_progress" }
>["data"];
export type Ref = { id: string; revision: string };
export type Operation =
  | "apply_plan"
  | "control_plan"
  | "register_wait"
  | "consume_wait"
  | "read_wait"
  | "continuation_reply"
  | "read_action"
  | "get_plan_progress";
export type ResourceKind =
  | "grant"
  | "input_request"
  | "changeset"
  | "root"
  | "environment"
  | "acceptance";
export type ErrorCode = CoreError["code"];
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: true,
});
const addFormats = addFormatsModule as unknown as (a: Ajv2020) => void;
addFormats(ajv);
ajv.addSchema(core);
const coreValidator = ajv.getSchema(core.$id)!;
const requestValidator = ajv.compile({
  oneOf: bindings.core.map((b) => ({
    $ref: core.$id + "#/$defs/" + b.operation,
  })),
});
const resourceValidator = ajv.compile(resource);
export function validateCore(value: unknown): value is CoreWire {
  return coreValidator(value) === true;
}
export function validateRequest(value: unknown): value is CoreRequest {
  return requestValidator(value);
}
export function validateResource(value: unknown): boolean {
  return resourceValidator(value);
}
export const operations = bindings.core.map((b) => b.operation) as Operation[];
export const resourceKinds = bindings.resources.map(
  (b) => b.resource_type,
) as ResourceKind[];
export const errorMapping = mapping.errors;
export const resourceFields = Object.fromEntries(
  resource.oneOf.map((s) => [
    s.properties.resource_type.const,
    Object.keys(
      resource.$defs[s.properties.resource_type.const as ResourceKind]
        .properties,
    ),
  ]),
) as Record<ResourceKind, string[]>;

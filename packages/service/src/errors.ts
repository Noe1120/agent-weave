import { errorMapping } from "../../contracts/src/index.ts";
import type {
  CoreRequest,
  CoreError,
  ErrorCode,
} from "../../contracts/src/index.ts";
export class ServiceFault extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}
export class TransportFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function fail(code: ErrorCode): never {
  throw new ServiceFault(code);
}
export function errorEnvelope(
  request: CoreRequest,
  code: ErrorCode,
): CoreError {
  return {
    contract_version: "core/1.0",
    kind: "service_error",
    request_id: request.request_id,
    project_id: request.project_id,
    operation: request.kind,
    code,
    retry_class: errorMapping[code].retry_class as CoreError["retry_class"],
    safe_message_key: errorMapping[code].safe_message_key,
    evidence_ref: null,
  };
}

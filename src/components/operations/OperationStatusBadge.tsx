import { Badge } from "@/components/ui/badge";
import {
  DISPATCH_STATUS_LABEL,
  OPERATION_STATUS_LABEL,
  operationStatusVariant,
  type DispatchStatus,
  type OperationStatus,
} from "@/lib/operations";

export function OperationStatusBadge({ status }: { status: OperationStatus }) {
  return <Badge variant={operationStatusVariant(status)}>{OPERATION_STATUS_LABEL[status]}</Badge>;
}

export function DispatchStatusBadge({ status }: { status: DispatchStatus }) {
  return <Badge variant="outline">{DISPATCH_STATUS_LABEL[status]}</Badge>;
}

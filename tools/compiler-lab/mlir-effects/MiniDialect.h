#ifndef MINI_EFFECT_DIALECT_H
#define MINI_EFFECT_DIALECT_H
#include "mlir/IR/Dialect.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/Interfaces/SideEffectInterfaces.h"
#include "MiniOpsDialect.h.inc"
#define GET_OP_CLASSES
#include "MiniOps.h.inc"
#endif

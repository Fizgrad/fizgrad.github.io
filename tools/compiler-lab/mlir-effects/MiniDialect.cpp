#include "MiniDialect.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/ImplicitLocOpBuilder.h"
#include "mlir/IR/OpImplementation.h"

using namespace mlir;
using namespace mini;
#include "MiniOpsDialect.cpp.inc"

void MiniDialect::initialize() {
  addOperations<
#define GET_OP_LIST
#include "MiniOps.cpp.inc"
      >();
}

void TouchOp::getEffects(
    llvm::SmallVectorImpl<MemoryEffects::EffectInstance> &Effects) {
  Effects.emplace_back(MemoryEffects::Write::get(),
                       SideEffects::DefaultResource::get());
}

#define GET_OP_CLASSES
#include "MiniOps.cpp.inc"

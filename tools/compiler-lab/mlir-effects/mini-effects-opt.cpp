#include "MiniDialect.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Tools/mlir-opt/MlirOptMain.h"
#include "mlir/Transforms/Passes.h"

int main(int argc, char **argv) {
  mlir::registerTransformsPasses();
  mlir::DialectRegistry Registry;
  Registry.insert<mini::MiniDialect, mlir::arith::ArithDialect,
                  mlir::func::FuncDialect>();
  return mlir::asMainReturnCode(
      mlir::MlirOptMain(argc, argv, "Memory effect example\n", Registry));
}

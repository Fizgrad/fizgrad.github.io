#include "llvm/Config/llvm-config.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/PassManager.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"

using namespace llvm;

namespace {
class MulToShiftPass : public PassInfoMixin<MulToShiftPass> {
public:
  PreservedAnalyses run(Function &F, FunctionAnalysisManager &) {
    bool Changed = false;
    for (BasicBlock &BB : F) {
      for (auto It = BB.begin(); It != BB.end();) {
        auto *Mul = dyn_cast<BinaryOperator>(&*It++);
        if (!Mul || Mul->getOpcode() != Instruction::Mul ||
            !Mul->getType()->isIntegerTy() ||
            Mul->getType()->getIntegerBitWidth() < 3)
          continue;
        Value *Input = nullptr;
        for (unsigned Index : {0u, 1u}) {
          auto *K = dyn_cast<ConstantInt>(Mul->getOperand(Index));
          if (K && K->equalsInt(2)) {
            Input = Mul->getOperand(1 - Index);
            break;
          }
        }
        if (!Input)
          continue;
        auto *Shift = BinaryOperator::CreateShl(
            Input, ConstantInt::get(Mul->getType(), 1), "", Mul->getIterator());
        Shift->takeName(Mul);
        Shift->setHasNoSignedWrap(Mul->hasNoSignedWrap());
        Shift->setHasNoUnsignedWrap(Mul->hasNoUnsignedWrap());
        Shift->setDebugLoc(Mul->getDebugLoc());
        Mul->replaceAllUsesWith(Shift);
        Mul->eraseFromParent();
        Changed = true;
      }
    }
    if (!Changed)
      return PreservedAnalyses::all();
    PreservedAnalyses PA;
    PA.preserveSet<CFGAnalyses>();
    return PA;
  }
};
} // namespace

extern "C" LLVM_ATTRIBUTE_WEAK PassPluginLibraryInfo llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "MulToShift", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            PB.registerPipelineParsingCallback(
                [](StringRef Name, FunctionPassManager &FPM,
                   ArrayRef<PassBuilder::PipelineElement>) {
                  if (Name != "mul-to-shift")
                    return false;
                  FPM.addPass(MulToShiftPass());
                  return true;
                });
          }};
}

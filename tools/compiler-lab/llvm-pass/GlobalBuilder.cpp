#include "llvm/IR/Constants.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"

using namespace llvm;

int main(int argc, char **argv) {
  if (argc != 2) {
    errs() << "usage: make-global input.ll\n";
    return 2;
  }
  LLVMContext Ctx;
  SMDiagnostic Error;
  auto M = parseIRFile(argv[1], Error, Ctx);
  if (!M) {
    Error.print(argv[0], errs());
    return 2;
  }
  if (M->getDataLayoutStr().empty() || M->getNamedValue("main") ||
      M->getNamedValue("lab_counter") || M->getNamedValue("lab_runtime_init") ||
      M->getNamedValue("lab.global.init")) {
    errs() << "input needs DataLayout and must not define reserved lab symbols\n";
    return 2;
  }
  Type *I32 = Type::getInt32Ty(Ctx);
  auto *G = new GlobalVariable(*M, I32, false, GlobalValue::InternalLinkage,
                               ConstantInt::get(I32, 0), "lab_counter");
  G->setAlignment(M->getDataLayout().getABITypeAlign(I32));
  FunctionCallee Runtime = M->getOrInsertFunction(
      "lab_runtime_init", FunctionType::get(I32, false));
  auto *Init = Function::Create(FunctionType::get(Type::getVoidTy(Ctx), false),
                                GlobalValue::InternalLinkage, "lab.global.init", *M);
  IRBuilder<> B(BasicBlock::Create(Ctx, "entry", Init));
  B.CreateStore(B.CreateCall(Runtime), G);
  B.CreateRetVoid();
  appendToGlobalCtors(*M, Init, 65535);

  auto *Main = Function::Create(FunctionType::get(I32, false),
                                GlobalValue::ExternalLinkage, "main", *M);
  B.SetInsertPoint(BasicBlock::Create(Ctx, "entry", Main));
  Value *Actual = B.CreateLoad(I32, G);
  B.CreateRet(B.CreateZExt(B.CreateICmpNE(Actual, B.getInt32(42)), I32));
  if (verifyModule(*M, &errs()))
    return 1;
  M->print(outs(), nullptr);
}

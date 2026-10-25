#ifndef MINI_EFFECT_OPS
#define MINI_EFFECT_OPS
include "mlir/IR/OpBase.td"
include "mlir/Interfaces/SideEffectInterfaces.td"

def Mini_Dialect : Dialect {
  let name = "mini";
  let cppNamespace = "::mini";
}
class Mini_Op<string mnemonic, list<Trait> traits = []>
    : Op<Mini_Dialect, mnemonic, traits>;

def Mini_AddOp : Mini_Op<"add", [Pure]> {
  let arguments = (ins I32:$lhs, I32:$rhs);
  let results = (outs I32:$result);
  let assemblyFormat = "$lhs `,` $rhs attr-dict `:` type($result)";
}

def Mini_TouchOp : Mini_Op<"touch", [
    DeclareOpInterfaceMethods<MemoryEffectsOpInterface>]> {
  let summary = "write a value to an external observation resource";
  let arguments = (ins I32:$value);
  let assemblyFormat = "$value attr-dict";
}

def Mini_UnknownOp : Mini_Op<"unknown"> {
  let summary = "an operation with no declared effect model";
  let arguments = (ins I32:$value);
  let assemblyFormat = "$value attr-dict";
}
#endif

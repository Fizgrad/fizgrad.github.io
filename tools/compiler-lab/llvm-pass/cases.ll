; RUN: opt -load-pass-plugin %plugin -passes='function(mul-to-shift),verify' -S %s | FileCheck %s
; %plugin is supplied by the local test driver, not a built-in lit substitution.

define i32 @plain(i32 %x) {
; CHECK-LABEL: define i32 @plain(
; CHECK: shl i32 %x, 1
  %r = mul i32 %x, 2
  ret i32 %r
}

define i32 @flags(i32 %x) {
; CHECK-LABEL: define i32 @flags(
; CHECK: shl nuw nsw i32 %x, 1
  %r = mul nuw nsw i32 2, %x
  ret i32 %r
}

define i32 @other_constant(i32 %x) {
; CHECK-LABEL: define i32 @other_constant(
; CHECK: mul i32 %x, 3
  %r = mul i32 %x, 3
  ret i32 %r
}

define <2 x i32> @vector_input(<2 x i32> %x) {
; CHECK-LABEL: define <2 x i32> @vector_input(
; CHECK: mul <2 x i32>
  %r = mul <2 x i32> %x, <i32 2, i32 2>
  ret <2 x i32> %r
}

define float @floating_input(float %x) {
; CHECK-LABEL: define float @floating_input(
; CHECK: fmul float %x,
  %r = fmul float %x, 2.0
  ret float %r
}

define i2 @narrow_signed(i2 %x) {
; CHECK-LABEL: define i2 @narrow_signed(
; CHECK: mul nsw i2 %x, -2
  %r = mul nsw i2 %x, 2
  ret i2 %r
}

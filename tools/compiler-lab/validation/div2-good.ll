define i32 @divide2(i32 %x) {
  %negative = lshr i32 %x, 31
  %biased = add i32 %x, %negative
  %r = ashr i32 %biased, 1
  ret i32 %r
}

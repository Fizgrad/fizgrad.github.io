define i32 @divide2(i32 %x) {
  %r = ashr i32 %x, 1
  ret i32 %r
}

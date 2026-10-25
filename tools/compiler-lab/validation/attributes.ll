declare void @observe(ptr captures(none)) memory(argmem: read)

define i32 @read_twice(ptr %p) {
  %before = load i32, ptr %p, align 4
  call void @observe(ptr %p)
  %after = load i32, ptr %p, align 4
  %sum = add i32 %before, %after
  ret i32 %sum
}

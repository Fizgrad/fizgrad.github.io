define i32 @sum(ptr %a, i32 %n, i1 %choose) {
entry:
  br i1 %choose, label %left, label %right
left:
  br label %header
right:
  br label %header
header:
  %i = phi i32 [0, %left], [0, %right], [%next, %body]
  %acc = phi i32 [0, %left], [0, %right], [%total, %body]
  %more = icmp slt i32 %i, %n
  br i1 %more, label %body, label %exit
body:
  %p = getelementptr i32, ptr %a, i32 %i
  %v = load i32, ptr %p, align 4
  %total = add i32 %acc, %v
  %next = add nuw nsw i32 %i, 1
  br label %header
exit:
  ret i32 %acc
}

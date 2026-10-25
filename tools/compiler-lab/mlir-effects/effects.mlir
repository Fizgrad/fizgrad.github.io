module {
  func.func @effects(%x: i32, %y: i32) -> i32 {
    %dead = mini.add %x, %y : i32
    %a = mini.add %x, %y : i32
    %b = mini.add %x, %y : i32
    mini.touch %a
    mini.touch %b
    mini.unknown %x
    return %b : i32
  }
}

# 1 · First words

**For:** your first time coding. **You'll need:** Node.js, and the `emerge` folder.

## The idea in one line

A program is a list of instructions, read from top to bottom.

## Try it

[`examples/1-hello.eg`](examples/1-hello.eg):

```eg
print("hello")

let name = "Ada"                 // let: a name for a value that never changes
print("hi {name}")               // {name} puts the value inside the text

fn double(x: num): num = x * 2   // fn: a recipe that turns an input into an output
print(double(21))

var steps = 0                    // var: a value that can change
for i in 1..4 {                  // 1..4 is 1, 2, 3
  steps += 1
  print("step {i}")
}
print("took {steps} steps")
```

```
cd emerge
node lang/eg.js run ../docs/learn/examples/1-hello.eg
```

```
hello
hi Ada
42
step 1
step 2
step 3
took 3 steps
```

## What happened

- `print` shows something on the screen.
- `let` gives a value a name. It can never change, so you can always trust it.
- `fn` is a recipe: give it `21`, it gives back `42`. `x: num` means "x must be a number". Emerge checks.
- `var` is a name whose value can change. `+=` adds to it.
- `for i in 1..4` repeats the block for `i` = 1, 2, 3. The end number is not included.
- `//` starts a note to humans. The computer skips it.

## The system view

Even here, Emerge keeps two kinds of names apart: ones that never change (`let`) and ones that do (`var`). Knowing which
things can change, and where, is the first question of every system.

## Your turn

1. Change `"Ada"` to your name.
2. Write `fn triple(x: num): num = x * 3` and print `triple(7)`.
3. Make the loop count to 10.

If you make a mistake, `node lang/eg.js check yourfile.eg` tells you the file, line and column.

**Next:** [2 · Things that remember](2-things-that-remember.md)

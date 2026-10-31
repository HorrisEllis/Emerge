# Runs a tests.py against a solution.py in the same folder. Prints "N passed, M failed" (same shape as js-runner.js).
import sys, builtins, runpy
d = sys.argv[1]; sys.path.insert(0, d)
res = {"p": 0, "f": 0}
def test(name, fn):
    try:
        ok = fn()
        if ok: res["p"] += 1; print("✓ " + name)
        else: res["f"] += 1; print("✗ " + name)
    except Exception as e:
        res["f"] += 1; print("✗ " + name + " — " + str(e))
def raises(fn):
    def check():
        try: fn()
        except Exception: return True
        return False
    return check
builtins.test, builtins.raises = test, raises
try: runpy.run_path(d + "/tests.py")
except Exception as e: res["f"] += 1; print("✗ load error — " + str(e))
print(f"{res['p']} passed, {res['f']} failed")

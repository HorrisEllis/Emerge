#!/bin/sh
# Times the same workload (work.*) five ways, best of 5 wall-clock runs each. Every way must print the same two lines.
cd "$(dirname "$0")"
EG=../../emerge/lang/eg.js
NATIVE=../../emerge/lang/native/bin/emerge
node $EG build work.eg -o out >/dev/null && $NATIVE work.eg -o work-native || exit 1
want=$(python3 work.py)
best() { b=999999; for i in 1 2 3 4 5; do s=$(date +%s%N); got=$("$@"); e=$(date +%s%N); [ "$got" = "$want" ] || { echo "MISMATCH: $*"; exit 1; }; t=$(( (e - s) / 1000000 )); [ $t -lt $b ] && b=$t; done; echo $b; }
printf '%-28s %8s ms\n' "Emerge interpreter (eg run)" "$(best node $EG run work.eg)"
printf '%-28s %8s ms\n' "Emerge -> JavaScript (build)" "$(best node out/work.js)"
printf '%-28s %8s ms\n' "Emerge native (x86-64 ELF)" "$(best ./work-native)"
printf '%-28s %8s ms\n' "JavaScript (Node $(node -v))" "$(best node work.js)"
printf '%-28s %8s ms\n' "Python $(python3 -V | cut -d' ' -f2)" "$(best python3 work.py)"
printf '%-28s %8s ms\n' "Node startup alone" "$(want=; best node -e 0)"
printf '%-28s %8s ms\n' "Python startup alone" "$(want=; best python3 -c 0)"

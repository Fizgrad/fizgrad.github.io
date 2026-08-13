#!/bin/sh

set -eu

base_url=${SYSTEMS_LAB_BASE_URL:-https://fizgrad.github.io/tools/systems-lab}
base_url=${base_url%/}
target=${1:-tools/systems-lab}

case "$target" in
    ""|/|.|..|-*)
        printf 'error: unsafe installation target: %s\n' "$target" >&2
        exit 2
        ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
    printf 'error: Systems Lab local tests require Linux\n' >&2
    exit 2
fi

if [ -e "$target" ] || [ -L "$target" ]; then
    printf 'error: target already exists: %s\n' "$target" >&2
    printf 'choose an empty path, for example: sh systems-lab-linux.sh systems-lab-local\n' >&2
    exit 2
fi

if command -v curl >/dev/null 2>&1; then
    fetch_file() {
        curl --fail --location --silent --show-error --retry 3 --connect-timeout 15 "$1" --output "$2"
    }
elif command -v wget >/dev/null 2>&1; then
    fetch_file() {
        wget --quiet --tries=3 --timeout=15 --output-document="$2" "$1"
    }
else
    printf 'error: curl or wget is required\n' >&2
    exit 2
fi

files='
README.md
JUDGE_PROMPT.md
practice.py
problems.json
support/test.hpp
support/linux_test.hpp
challenges/select-ready/starter.cpp
challenges/select-ready/tests.cpp
challenges/select-ready/reference.cpp
challenges/poll-events/starter.cpp
challenges/poll-events/tests.cpp
challenges/poll-events/reference.cpp
challenges/epoll-ready/starter.cpp
challenges/epoll-ready/tests.cpp
challenges/epoll-ready/reference.cpp
challenges/bounded-queue/starter.cpp
challenges/bounded-queue/tests.cpp
challenges/bounded-queue/reference.cpp
challenges/thread-pool/starter.cpp
challenges/thread-pool/tests.cpp
challenges/thread-pool/reference.cpp
challenges/framed-socket/starter.cpp
challenges/framed-socket/tests.cpp
challenges/framed-socket/reference.cpp
'

temporary=$(mktemp -d "${TMPDIR:-/tmp}/systems-lab-install.XXXXXX")
package=$temporary/package
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
mkdir -p "$package"

for path in $files; do
    output=$package/$path
    mkdir -p "$(dirname "$output")"
    printf 'download %s\n' "$path"
    fetch_file "$base_url/$path" "$output"
done

chmod +x "$package/practice.py"
python3 "$package/practice.py" list >/dev/null
mkdir -p -- "$(dirname -- "$target")"
mv -- "$package" "$target"

printf '\ninstalled: %s\n' "$target"
printf 'check:     python3 %s/practice.py doctor\n' "$target"
printf 'list:      python3 %s/practice.py list\n' "$target"

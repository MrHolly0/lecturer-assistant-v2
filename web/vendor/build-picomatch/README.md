# Build-only picomatch

Vendored from the MIT-licensed npm package `picomatch@4.0.7`. The original
copyright notice is in LICENSE. The registry tarball has SHA-512 integrity
`qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`.

The only upstream source change is in `extglobOpen` in lib/parse.js. Our build
rejects both repeating extglob operators before the matcher can compile them.
This intentionally limits the build pattern language while GHSA-fc5q-39xc-vjpf
has no fixed registry version. Ordinary wildcards, globstars, braces and
non-repeating extglobs retain upstream behavior. The npm override applies to
both Vite and tinyglobby. The runtime web image serves static files.

After a fixed upstream release, update both dependency resolutions, remove
the local package and override, and verify clean install, audit and web build.

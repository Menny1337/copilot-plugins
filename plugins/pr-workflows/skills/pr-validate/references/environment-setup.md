# Prepare the check environment

Missing dependencies or an incompatible installed runtime are setup work, not
terminal blockers. Prepare only what the selected review or validation checks
need, in an isolated or explicitly owned environment.

1. Read repository setup guidance, manifests, the existing lockfile, runtime
   pins, engine constraints, and package-manager configuration. Inspect install
   hooks and check commands for unsafe side effects before executing them.
2. Select or provision compatible runtimes and tools using the repository's
   supported version manager or setup path. Keep tools current within repository
   pins and engine constraints; do not blindly upgrade to the newest major.
   For example, Node 26 does not satisfy `>=24.22.1 <25`: select or provision a
   supported Node 24 release satisfying that range. Verify the versions actually
   used by the package manager and checks, not just the interactive shell.
3. Install or restore needed dependencies with the repository's package manager
   and existing lockfile using its immutable/frozen install mode (for example,
   `npm ci` or the supported frozen-lockfile equivalent). Do this proactively on
   a fresh checkout; do not wait for a missing-module failure. Do not upgrade
   dependencies, rewrite lockfiles, or edit application source to make setup pass.
4. Run the selected checks and verify tracked source, manifests, and lockfiles
   remain unchanged. Preserve unrelated work and obtain required authorization
   for sensitive access, unsafe hooks, or external mutations; setup does not
   authorize deployments, shared-service changes, commits, pushes, reviewer
   votes, or thread resolution.

If provisioning or restore fails, retain the command and error, try a supported
alternative within these boundaries, then report the concrete remaining blocker
and unexecuted checks. Do not present an unprepared environment as a PR defect
or claim the checks passed.

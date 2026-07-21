
# Azure DevOps Repos & Pull Requests

Manage Azure DevOps repositories, pull requests, branch policies, and code reviews using the `az repos` CLI.


## When to Use

- Creating, listing, or managing Azure DevOps Git repositories
- Full PR lifecycle: create, review, vote, complete, abandon
- Adding/removing reviewers and linking work items to PRs
- Configuring branch policies (approver count, build validation, merge strategy, required reviewers)
- Managing branch and tag refs
- Checking out PRs locally for review
- Querying PR policy status before completion

## When to Skip

- **GitHub repositories** → use `gh` CLI (gh pr, gh repo)
- **Work items, boards, sprints** → use `devops-boards.md` reference (`az boards`)
- **Pipelines, builds, releases** → use `devops-pipelines.md` reference (`az pipelines`)
- **General Azure DevOps auth/config** → use the Foundations section in the az skill


## Prerequisites

Requires the Foundations section in the az skill for authentication and default configuration.

```bash
# Install the azure-devops extension (if not already present)
az extension add --name azure-devops

# Configure defaults so you don't have to pass --org and --project every time
az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG project=YOUR_PROJECT
```

Verify access:

```bash
az repos list --output table
```


## Repository Management

### List repositories

```bash
az repos list --output table
az repos list --query "[?name=='MyRepo']" --output table
```

### Show repository details

```bash
az repos show --repository MyRepo --output json
```

### Create a repository

```bash
az repos create --name MyNewRepo --output json
```

### Delete a repository

```bash
az repos delete --id <repo-id> --yes
```

### Import a repository (from external Git URL)

```bash
az repos import create --git-source-url https://github.com/org/repo.git --repository MyNewRepo
```


## Branch & Tag Refs

### List refs (branches and tags)

```bash
# List branches
az repos ref list --repository MyRepo --filter heads/ --output table

# List tags
az repos ref list --repository MyRepo --filter tags/ --output table
```

### Create a branch

```bash
az repos ref create --repository MyRepo \
  --name refs/heads/feature/my-feature \
  --object-id <source-commit-sha>
```

### Delete a branch

```bash
az repos ref delete --repository MyRepo \
  --name refs/heads/feature/old-branch \
  --object-id <current-tip-commit-sha>
```

> **Note:** `--object-id` on delete must be the current tip of the branch (prevents accidental deletion of updated branches).


## Pull Request Lifecycle

### Create a PR

```bash
az repos pr create \
  --title "Add user authentication" \
  --source-branch feature/user-auth \
  --target-branch main \
  --description "Implements JWT-based authentication with login and refresh endpoints." \
  --output json
```

Optional flags:

```bash
  --repository MyRepo           # if not inferred from current directory
  --reviewers user@org.com      # add reviewers at creation
  --work-items 1234 5678        # link work items at creation
  --draft                       # create as draft PR
  --auto-complete               # set to auto-complete when policies pass
  --squash                      # squash merge on completion
  --delete-source-branch        # delete source branch after merge
```

### List PRs

```bash
# All active PRs
az repos pr list --output table

# PRs targeting a specific branch
az repos pr list --target-branch main --output table

# PRs by a specific author
az repos pr list --creator user@org.com --output table

# PRs in a specific repository
az repos pr list --repository MyRepo --status active --output table

# All statuses: active, completed, abandoned, all
az repos pr list --status all --output table
```

### Show PR details

```bash
az repos pr show --id 12345 --output json
```

### Update a PR

```bash
# Complete a PR
az repos pr update --id 12345 --status completed

# Abandon a PR
az repos pr update --id 12345 --status abandoned

# Reactivate an abandoned PR
az repos pr update --id 12345 --status active

# Update title or description
az repos pr update --id 12345 --title "Updated title"
az repos pr update --id 12345 --description "Updated description"

# Enable auto-complete
az repos pr update --id 12345 --auto-complete true

# Set squash merge and delete source branch on completion
az repos pr update --id 12345 --squash --delete-source-branch
```

### Vote on a PR

```bash
az repos pr set-vote --id 12345 --vote approve
```

All vote values:

| Value                      | Meaning                                    |
| -------------------------- | ------------------------------------------ |
| `approve`                  | Approved                                   |
| `approve-with-suggestions` | Approved with suggestions                  |
| `wait-for-author`          | Waiting for author (blocks completion)     |
| `reject`                   | Rejected (blocks completion)               |
| `reset`                    | Reset vote (remove previous vote)          |

### Checkout a PR locally

```bash
az repos pr checkout --id 12345
```

This fetches the PR branch and checks it out in your local git repository.

### Manage reviewers

```bash
# Add reviewers
az repos pr reviewer add --id 12345 --reviewers user1@org.com user2@org.com

# Add a group as reviewer
az repos pr reviewer add --id 12345 --reviewers "[MyProject]\My Review Team"

# List reviewers
az repos pr reviewer list --id 12345 --output table

# Remove a reviewer
az repos pr reviewer remove --id 12345 --reviewer-id <reviewer-id>
```

### Link work items

```bash
# Add work items to a PR
az repos pr work-item add --id 12345 --work-items 6789 1011

# List linked work items
az repos pr work-item list --id 12345 --output table

# Remove a work item link
az repos pr work-item remove --id 12345 --work-item-id 6789
```

### Check policy status

```bash
az repos pr policy list --id 12345 --output table
```

This shows which policies are passing/failing before you attempt to complete the PR.


## Branch Policies

Branch policies enforce code quality gates. Each policy type has `create` and `update` subcommands.

### List and show policies

```bash
# List all policies in the project
az repos policy list --output table

# List policies for a specific branch
az repos policy list --branch main --repository-id <repo-id> --output table

# Show a specific policy
az repos policy show --id <policy-id> --output json
```

### Approver count

Require a minimum number of reviewers.

```bash
az repos policy approver-count create \
  --branch main \
  --repository-id <repo-id> \
  --minimum-approver-count 2 \
  --creator-vote-counts false \
  --allow-downvotes false \
  --reset-on-source-push true \
  --blocking true \
  --enabled true

az repos policy approver-count update --id <policy-id> \
  --minimum-approver-count 3
```

### Build validation

Require a build to pass before completion.

```bash
az repos policy build create \
  --branch main \
  --repository-id <repo-id> \
  --build-definition-id <build-def-id> \
  --display-name "CI Build" \
  --queue-on-source-update-only true \
  --valid-duration 720 \
  --blocking true \
  --enabled true

az repos policy build update --id <policy-id> \
  --build-definition-id <new-build-def-id>
```

### Comment required

Require all PR comments to be resolved.

```bash
az repos policy comment-required create \
  --branch main \
  --repository-id <repo-id> \
  --blocking true \
  --enabled true

az repos policy comment-required update --id <policy-id> \
  --blocking false
```

### Merge strategy

Restrict allowed merge types.

```bash
az repos policy merge-strategy create \
  --branch main \
  --repository-id <repo-id> \
  --allow-squash true \
  --allow-no-fast-forward true \
  --allow-rebase false \
  --allow-rebase-merge false \
  --blocking true \
  --enabled true

az repos policy merge-strategy update --id <policy-id> \
  --allow-rebase true
```

### Required reviewers

Automatically add required reviewers for specific file paths.

```bash
az repos policy required-reviewer create \
  --branch main \
  --repository-id <repo-id> \
  --required-reviewer-ids "user1@org.com;user2@org.com" \
  --message "Security review required for auth changes" \
  --path-filter "/src/auth/*" \
  --blocking true \
  --enabled true

az repos policy required-reviewer update --id <policy-id> \
  --required-reviewer-ids "user3@org.com"
```

### Work item linking

Require PRs to be linked to work items.

```bash
az repos policy work-item-linking create \
  --branch main \
  --repository-id <repo-id> \
  --blocking true \
  --enabled true

az repos policy work-item-linking update --id <policy-id> \
  --blocking false
```

### Case enforcement

Enforce consistent branch name casing.

```bash
az repos policy case-enforcement create \
  --branch main \
  --repository-id <repo-id> \
  --blocking true \
  --enabled true
```

### File size

Restrict maximum file size in pushes.

```bash
az repos policy file-size create \
  --branch main \
  --repository-id <repo-id> \
  --maximum-git-blob-size 10485760 \
  --use-uncompressed-size true \
  --blocking true \
  --enabled true
```


## Common Workflows

### Create a PR and add reviewers

```bash
# Create the PR
PR_ID=$(az repos pr create \
  --title "feat: add notification service" \
  --source-branch feature/notifications \
  --target-branch main \
  --description "Adds email and push notification support." \
  --work-items 4567 \
  --auto-complete \
  --delete-source-branch \
  --query pullRequestId \
  --output tsv)

echo "Created PR #$PR_ID"

# Add reviewers
az repos pr reviewer add --id $PR_ID --reviewers lead@org.com senior@org.com
```

### Complete a PR after approval

```bash
# Check policy status first
az repos pr policy list --id 12345 --output table

# If all policies pass, complete
az repos pr update --id 12345 --status completed --squash --delete-source-branch
```

### List open PRs for a branch

```bash
# PRs targeting main
az repos pr list --target-branch main --status active --output table

# PRs from your feature branch
az repos pr list --source-branch feature/my-work --status active --output table
```

### Full review workflow

```bash
# Check out the PR locally
az repos pr checkout --id 12345

# Review the code, run tests...
npm test

# Vote to approve
az repos pr set-vote --id 12345 --vote approve

# Or request changes
az repos pr set-vote --id 12345 --vote wait-for-author
```


## Gotchas

- **Vote values must be exact strings** — only `approve`, `approve-with-suggestions`, `wait-for-author`, `reject`, `reset` are valid. Any other string will error.
- **Policy IDs are required for updates** — use `az repos policy list` to find the ID before running `az repos policy <type> update --id <policy-id>`.
- **`--auto-complete` on create vs update** — on `az repos pr create` it's a flag (`--auto-complete`), on `az repos pr update` it takes a value (`--auto-complete true`).
- **Repository ID vs name** — policy commands require `--repository-id` (a GUID), not the repo name. Get it from `az repos show --repository MyRepo --query id --output tsv`.
- **`--delete-source-branch`** — only takes effect when the PR is completed, not when set.
- **Branch names in policies** — use just the branch name (e.g., `main`), not the full ref path (`refs/heads/main`).
- **Reviewer IDs for removal** — `az repos pr reviewer remove` needs `--reviewer-id` (a GUID), not an email. Get it from `az repos pr reviewer list`.


## Reference

- [az repos CLI reference](https://learn.microsoft.com/en-us/cli/azure/repos)
- [az repos pr CLI reference](https://learn.microsoft.com/en-us/cli/azure/repos/pr)
- [az repos policy CLI reference](https://learn.microsoft.com/en-us/cli/azure/repos/policy)
- [Branch policies overview](https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies-overview)
- [Pull request workflow](https://learn.microsoft.com/en-us/azure/devops/repos/git/pull-requests)

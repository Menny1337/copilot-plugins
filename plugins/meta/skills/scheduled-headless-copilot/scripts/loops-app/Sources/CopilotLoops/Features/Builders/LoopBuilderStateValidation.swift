import Foundation
import LoopsModels

extension LoopBuilderState {

    // MARK: Validation entry points

    /// Full validation across every step. Used by the review view to make the
    /// Enable button truly conservative.
    func validate() -> [BuilderIssue] {
        BuilderStep.allCases.flatMap { validate(step: $0) }
    }

    /// Validation for a single step. The wizard uses this to gate the
    /// Continue button per step.
    func validate(step: BuilderStep) -> [BuilderIssue] {
        switch step {
        case .configure:
            return kind == .copilot ? validateCopilotConfigure() : validateScriptConfigure()
        case .permissions:
            return validatePermissions()
        case .schedule:
            return validateSchedule()
        case .review:
            return validateReview()
        }
    }

    /// True when the wizard should show the Continue affordance as enabled.
    func canAdvance(from step: BuilderStep) -> Bool {
        !validate(step: step).contains(where: { $0.severity == .error })
    }

    // MARK: Step navigation

    func advance() {
        guard let next = nextStep(after: currentStep) else { return }
        markVisited(next)
        currentStep = next
    }

    func retreat() {
        guard let previous = previousStep(before: currentStep) else { return }
        currentStep = previous
    }

    func jump(to step: BuilderStep) {
        // Only allow jumping to steps that have already been visited (or one
        // step forward). Prevents the sidebar from skipping past required
        // fields in the current step.
        if visitedSteps.contains(step) {
            currentStep = step
            return
        }
        if let next = nextStep(after: currentStep), next == step, canAdvance(from: currentStep) {
            markVisited(next)
            currentStep = next
        }
    }

    private func markVisited(_ step: BuilderStep) {
        visitedSteps.insert(step)
    }

    private func nextStep(after step: BuilderStep) -> BuilderStep? {
        BuilderStep.allCases.first(where: { $0.rawValue == step.rawValue + 1 })
    }

    private func previousStep(before step: BuilderStep) -> BuilderStep? {
        BuilderStep.allCases.first(where: { $0.rawValue == step.rawValue - 1 })
    }

    // MARK: Configure — Copilot

    private func validateCopilotConfigure() -> [BuilderIssue] {
        var issues: [BuilderIssue] = []
        appendCoreIdentity(&issues)

        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedModel.isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .model,
                message: "Choose a model or type one manually."
            ))
        }

        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedPrompt.isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .prompt,
                message: "The prompt is required. Skills are only enforced through the prompt text."
            ))
        }

        if copilotWorkingDirectory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .workingDirectory,
                message: "Set an absolute working directory for the Copilot process."
            ))
        } else if !isAbsolutePath(copilotWorkingDirectory) {
            issues.append(BuilderIssue(
                step: .configure,
                field: .workingDirectory,
                message: "Working directory must be an absolute path (starts with /)."
            ))
        }

        for row in copilotExtraPaths where !row.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !isAbsolutePath(row.path) {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .extraPath(id: row.id),
                    message: "Extra paths must be absolute (start with /)."
                ))
            }
        }

        for row in localPluginPaths where !row.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !isAbsolutePath(row.path) {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .pluginPath(id: row.id),
                    message: "Local plugin directories must be absolute paths."
                ))
            }
        }

        // If an installed plugin is chosen and the picked agent/skill is
        // recorded in inventory under a different plugin, refuse — Copilot
        // will not resolve them.
        let trimmedPlugin = installedPlugin.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAgent = agent.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSkill = skill.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPlugin.isEmpty {
            if !trimmedAgent.isEmpty,
               let match = inventory.agents.first(where: { $0.name == trimmedAgent }),
               let matchPlugin = match.plugin, matchPlugin != trimmedPlugin {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .agent,
                    message: "Agent \"\(trimmedAgent)\" belongs to plugin \"\(matchPlugin)\", not \"\(trimmedPlugin)\"."
                ))
            }
            if !trimmedSkill.isEmpty,
               let match = inventory.skills.first(where: { $0.name == trimmedSkill }),
               let matchPlugin = match.plugin, matchPlugin != trimmedPlugin {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .skill,
                    message: "Skill \"\(trimmedSkill)\" belongs to plugin \"\(matchPlugin)\", not \"\(trimmedPlugin)\"."
                ))
            }
        }

        // Reject explicitly disabled inventory items so the user is nudged to
        // pick an enabled one (or an unlisted manual entry).
        if !trimmedAgent.isEmpty,
           let match = inventory.agents.first(where: { $0.name == trimmedAgent }),
           match.enabled == false {
            issues.append(BuilderIssue(
                step: .configure,
                field: .agent,
                message: "Agent \"\(trimmedAgent)\" is currently disabled in the inventory."
            ))
        }
        if !trimmedSkill.isEmpty,
           let match = inventory.skills.first(where: { $0.name == trimmedSkill }),
           match.enabled == false {
            issues.append(BuilderIssue(
                step: .configure,
                field: .skill,
                message: "Skill \"\(trimmedSkill)\" is currently disabled in the inventory."
            ))
        }

        return issues
    }

    // MARK: Configure — Script

    private func validateScriptConfigure() -> [BuilderIssue] {
        var issues: [BuilderIssue] = []
        appendCoreIdentity(&issues)

        switch scriptMode {
        case .scriptFile:
            if scriptPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .scriptPath,
                    message: "Choose a script file to run."
                ))
            } else if !isAbsolutePath(scriptPath) {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .scriptPath,
                    message: "Script path must be absolute (start with /)."
                ))
            } else {
                // A missing / mismatched / non-canonical hash is a fatal
                // error. Permission approval binds to the exact SHA-256, so
                // we never let Continue pass without one for the *active*
                // path.
                if let hash = scriptHash, hash.path != scriptPath {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .scriptPath,
                        message: "Content hash was computed for a different path. Re-hash the current script."
                    ))
                } else if let hash = scriptHash, !LoopBuilderState.isValidSHA256Hex(hash.hash) {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .scriptPath,
                        message: "Script content hash is not a valid SHA-256 digest."
                    ))
                } else if (scriptHash?.hash.isEmpty ?? true) {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .scriptPath,
                        message: "Compute the script content hash before continuing."
                    ))
                }
            }
        case .executable:
            if executablePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .executablePath,
                    message: "Choose the executable to launch."
                ))
            } else if !isAbsolutePath(executablePath) {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .executablePath,
                    message: "Executable path must be absolute."
                ))
            } else {
                if let hash = scriptHash, hash.path != executablePath {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .executablePath,
                        message: "Content hash was computed for a different path. Re-hash the current executable."
                    ))
                } else if let hash = scriptHash, !LoopBuilderState.isValidSHA256Hex(hash.hash) {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .executablePath,
                        message: "Executable hash is not a valid SHA-256 digest."
                    ))
                } else if (scriptHash?.hash.isEmpty ?? true) {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .executablePath,
                        message: "Compute the executable SHA-256 before continuing."
                    ))
                }
            }
        }

        for row in scriptArguments where !row.value.isEmpty {
            if row.value.contains("\n") {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .argument(id: row.id),
                    message: "Arguments cannot contain newlines. Add another row instead."
                ))
            }
        }

        if scriptWorkingDirectory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .workingDirectory,
                message: "Set an absolute working directory for the script."
            ))
        } else if !isAbsolutePath(scriptWorkingDirectory) {
            issues.append(BuilderIssue(
                step: .configure,
                field: .workingDirectory,
                message: "Working directory must be absolute (start with /)."
            ))
        }

        // Plain env: names required if a value is present, and no duplicates
        // between plain rows.
        var seenPlainNames: [String: String] = [:]
        for row in environmentRows {
            let trimmedName = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedName.isEmpty && !row.value.isEmpty {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .envRowName(id: row.id),
                    message: "Environment variables need a name."
                ))
            } else if !trimmedName.isEmpty {
                if !isValidEnvName(trimmedName) {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .envRowName(id: row.id),
                        message: "Environment variable names must match [A-Za-z_][A-Za-z0-9_]*."
                    ))
                }
                if let existingID = seenPlainNames[trimmedName], existingID != row.id {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .envRowName(id: row.id),
                        message: "Environment variable \"\(trimmedName)\" is defined more than once."
                    ))
                } else {
                    seenPlainNames[trimmedName] = row.id
                }
            }
        }

        // Secret rows: name required; regex-legal; unique within secrets and
        // NOT colliding with plain env names.
        var seenSecretNames: [String: String] = [:]
        for row in secretRows {
            let trimmedName = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedName.isEmpty {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .secretRowName(id: row.id),
                    message: "Secret environment variables need a name."
                ))
            } else if !isValidEnvName(trimmedName) {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .secretRowName(id: row.id),
                    message: "Secret names must match [A-Za-z_][A-Za-z0-9_]*."
                ))
            } else {
                if let existingID = seenSecretNames[trimmedName], existingID != row.id {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .secretRowName(id: row.id),
                        message: "Secret \"\(trimmedName)\" is listed more than once."
                    ))
                } else {
                    seenSecretNames[trimmedName] = row.id
                }
                if seenPlainNames[trimmedName] != nil {
                    issues.append(BuilderIssue(
                        step: .configure,
                        field: .secretRowName(id: row.id),
                        message: "\"\(trimmedName)\" is defined as both a plain env variable and a secret."
                    ))
                }
            }
            if !row.isStored && row.value.isEmpty {
                issues.append(BuilderIssue(
                    step: .configure,
                    field: .secretRowValue(id: row.id),
                    severity: .warning,
                    message: "Provide a value or remove this secret row before saving."
                ))
            }
        }

        // Surface hash-time problems (missing shebang, not executable, etc)
        // as configure issues so Continue is disabled until resolved.
        if let hash = scriptHash {
            for problem in hash.problems {
                let field: BuilderIssue.Field = scriptMode == .scriptFile ? .scriptPath : .executablePath
                // For executables we don't require a shebang, so a missing
                // one is only informational.
                let severity: BuilderIssue.Severity =
                    (problem == .missingShebang && scriptMode == .executable) ? .warning : .error
                issues.append(BuilderIssue(
                    step: .configure,
                    field: field,
                    severity: severity,
                    message: problem.message
                ))
            }
        }

        return issues
    }

    // MARK: Configure — shared identity

    private func appendCoreIdentity(_ issues: inout [BuilderIssue]) {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .name,
                message: "Give the loop a human-readable name."
            ))
        } else if trimmedName.count > LoopBuilderState.maxNameLength {
            issues.append(BuilderIssue(
                step: .configure,
                field: .name,
                message: "Name is limited to \(LoopBuilderState.maxNameLength) characters."
            ))
        }

        let trimmedID = loopID.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedID.isEmpty {
            issues.append(BuilderIssue(
                step: .configure,
                field: .id,
                message: "Loop id is required (letters, digits, hyphens)."
            ))
        } else if trimmedID.count > LoopBuilderState.maxLoopIDLength {
            issues.append(BuilderIssue(
                step: .configure,
                field: .id,
                message: "Loop id is limited to \(LoopBuilderState.maxLoopIDLength) characters."
            ))
        } else if !isValidLoopID(trimmedID) {
            issues.append(BuilderIssue(
                step: .configure,
                field: .id,
                message: "Loop id must match [a-z0-9](?:[a-z0-9-]{0,\(LoopBuilderState.maxLoopIDLength - 2)}[a-z0-9])?."
            ))
        }
    }

    // MARK: Permissions

    private func validatePermissions() -> [BuilderIssue] {
        var issues: [BuilderIssue] = []
        // Script loops don't run Copilot's tool/URL gating, so nothing to
        // validate here.
        guard kind == .copilot else { return issues }
        guard permissionProfile == .custom else { return issues }

        let hasEntry = ![allowTools, denyTools, allowUrls, denyUrls]
            .flatMap({ $0 })
            .allSatisfy({ $0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        if !hasEntry {
            issues.append(BuilderIssue(
                step: .permissions,
                field: .allowTool(id: "root"),
                severity: .warning,
                message: "Custom permissions selected but no allow/deny entries have been added."
            ))
        }

        for row in allowTools where !row.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if row.value.contains(" ") || row.value.contains("\n") {
                issues.append(BuilderIssue(
                    step: .permissions,
                    field: .allowTool(id: row.id),
                    message: "Tool names cannot contain whitespace."
                ))
            }
        }
        for row in denyTools where !row.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if row.value.contains(" ") || row.value.contains("\n") {
                issues.append(BuilderIssue(
                    step: .permissions,
                    field: .denyTool(id: row.id),
                    message: "Tool names cannot contain whitespace."
                ))
            }
        }
        for row in allowUrls where !row.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !isAbsoluteHTTPURL(row.value) {
                issues.append(BuilderIssue(
                    step: .permissions,
                    field: .allowUrl(id: row.id),
                    message: "Allow URL must be an absolute http(s):// address."
                ))
            }
        }
        for row in denyUrls where !row.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !isAbsoluteHTTPURL(row.value) {
                issues.append(BuilderIssue(
                    step: .permissions,
                    field: .denyUrl(id: row.id),
                    message: "Deny URL must be an absolute http(s):// address."
                ))
            }
        }
        return issues
    }

    // MARK: Schedule

    private func validateSchedule() -> [BuilderIssue] {
        var issues: [BuilderIssue] = []
        switch scheduleKind {
        case .manual:
            break
        case .oneTime:
            // Compare on minute-precision because the picker/serialized form
            // both drop sub-minute components.
            let normalized = LoopBuilderState.floorToMinute(oneTimeDate, calendar: .current)
            let flooredNow = LoopBuilderState.floorToMinute(now(), calendar: .current)
            if normalized <= flooredNow {
                issues.append(BuilderIssue(
                    step: .schedule,
                    field: .scheduleTime,
                    message: "One-time schedule must be at least the next minute in the future."
                ))
            }
        case .dailyCalendar:
            break
        case .weekdayCalendar:
            if selectedWeekdays.isEmpty {
                issues.append(BuilderIssue(
                    step: .schedule,
                    field: .scheduleWeekdays,
                    message: "Pick at least one weekday."
                ))
            }
        case .interval:
            if intervalSeconds < 60 {
                issues.append(BuilderIssue(
                    step: .schedule,
                    field: .scheduleInterval,
                    message: "Interval must be at least 60 seconds."
                ))
            }
            if intervalSeconds > 31_536_000 {
                issues.append(BuilderIssue(
                    step: .schedule,
                    field: .scheduleInterval,
                    message: "Interval cannot exceed one year (31,536,000 seconds)."
                ))
            }
        }

        // Timeout — canonical 0...604800. 0 explicitly means "no timeout".
        if timeoutSeconds < 0 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .timeout,
                message: "Timeout cannot be negative. Use 0 for no timeout."
            ))
        } else if timeoutSeconds > 604_800 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .timeout,
                message: "Timeout cannot exceed 604,800 seconds (7 days)."
            ))
        }

        // Retries — 0...5.
        if maxRetries < 0 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .retries,
                message: "Retries cannot be negative."
            ))
        } else if maxRetries > 5 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .retries,
                message: "Retries are capped at 5 per run."
            ))
        }

        // Backoff — 0...86400.
        if backoffSeconds < 0 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .backoff,
                message: "Retry backoff cannot be negative."
            ))
        } else if backoffSeconds > 86_400 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .backoff,
                message: "Retry backoff is capped at 86,400 seconds (24 hours)."
            ))
        }

        // Retention — days 1...3650, runs 1...10000.
        if retentionDays < 1 || retentionDays > 3650 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .retention,
                message: "Retention days must be between 1 and 3,650."
            ))
        }
        if retentionMaxRuns < 1 || retentionMaxRuns > 10_000 {
            issues.append(BuilderIssue(
                step: .schedule,
                field: .retention,
                message: "Retention run count must be between 1 and 10,000."
            ))
        }

        return issues
    }

    // MARK: Review

    private func validateReview() -> [BuilderIssue] {
        // The review step only gates on issues from earlier steps and on the
        // acknowledgement checkbox; the checkbox itself isn't a field-level
        // error, so we surface it separately in the view.
        []
    }

    // MARK: Helpers

    private func isAbsolutePath(_ raw: String) -> Bool {
        raw == raw.trimmingCharacters(in: .whitespacesAndNewlines) && raw.hasPrefix("/")
    }

    private func isValidLoopID(_ raw: String) -> Bool {
        // 1-64 chars, lowercase alphanumeric with internal hyphens.
        let maxInternal = LoopBuilderState.maxLoopIDLength - 2
        let pattern = "^[a-z0-9](?:[a-z0-9-]{0,\(maxInternal)}[a-z0-9])?$"
        return raw.range(of: pattern, options: .regularExpression) != nil
    }

    private func isValidEnvName(_ raw: String) -> Bool {
        raw.range(of: #"^[A-Za-z_][A-Za-z0-9_]*$"#, options: .regularExpression) != nil
    }

    /// True iff `raw` parses as an absolute http/https URL with a non-empty
    /// host. Foundation happily returns `URL(string: "foo")` as a valid
    /// relative URL — reject that here.
    private func isAbsoluteHTTPURL(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else { return false }
        guard let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return false }
        guard let host = components.host, !host.isEmpty else { return false }
        return true
    }
}

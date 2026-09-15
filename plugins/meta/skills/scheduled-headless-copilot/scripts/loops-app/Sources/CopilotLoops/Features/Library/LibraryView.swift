import SwiftUI
import LoopsModels

public struct LibraryTemplate: Identifiable {
    public let id: String
    public let name: String
    public let description: String
    public let kind: LoopKind
    public let category: String
    public let icon: String
}

public struct LibraryView: View {
    let templateItems: [TemplateItem]
    let issues: [ControlIssue]
    let onUseTemplate: (String) -> Void
    let onCreateBlank: (LoopKind) -> Void

    @State private var selectedCategory: String = "All"
    @State private var isGridView: Bool = true

    private let categories = ["All", "Maintenance", "Reporting", "Blank"]

    private static let fallbackTemplates: [LibraryTemplate] = [
        LibraryTemplate(
            id: "nightly-dependency-report",
            name: "Nightly dependency report",
            description: "Review dependency manifests and write a concise markdown report using an AI researcher.",
            kind: .copilot,
            category: "Reporting",
            icon: "doc.text.magnifyingglass"
        ),
        LibraryTemplate(
            id: "repository-maintenance",
            name: "Repository maintenance",
            description: "Run standard git and cleanup scripts on a schedule to keep your repository healthy.",
            kind: .script,
            category: "Maintenance",
            icon: "wrench.and.screwdriver"
        ),
        LibraryTemplate(
            id: "scheduled-skill-review",
            name: "Scheduled skill review",
            description: "Periodically review and improve skills. Note: This creates a separate managed Copilot loop, it does not adopt the existing system daemon.",
            kind: .copilot,
            category: "Maintenance",
            icon: "brain.head.profile"
        )
    ]

    private static let fallbackBlankTemplates: [LibraryTemplate] = [
        LibraryTemplate(
            id: "blank-copilot",
            name: "Blank Copilot",
            description: "Start fresh with a blank Copilot loop to perform AI-driven autonomous tasks.",
            kind: .copilot,
            category: "Blank",
            icon: "sparkles.rectangle"
        ),
        LibraryTemplate(
            id: "blank-script",
            name: "Blank Script",
            description: "Start fresh with a standard executable script loop for conventional automation.",
            kind: .script,
            category: "Blank",
            icon: "terminal"
        )
    ]

    public init(
        templateItems: [TemplateItem] = [],
        issues: [ControlIssue] = [],
        onUseTemplate: @escaping (String) -> Void,
        onCreateBlank: @escaping (LoopKind) -> Void
    ) {
        self.templateItems = templateItems
        self.issues = issues
        self.onUseTemplate = onUseTemplate
        self.onCreateBlank = onCreateBlank
    }

    private var templates: [LibraryTemplate] {
        guard !templateItems.isEmpty else {
            return Self.fallbackTemplates + Self.fallbackBlankTemplates
        }
        return templateItems.compactMap { item in
            guard let kindValue = item.kind,
                  let kind = LoopKind(rawValue: kindValue)
            else { return nil }
            return LibraryTemplate(
                id: item.key,
                name: item.title ?? item.key,
                description: item.description ?? "Configure this managed loop template.",
                kind: kind,
                category: category(for: item.key),
                icon: icon(for: item.key, kind: kind)
            )
        }
    }

    private var filteredTemplates: [LibraryTemplate] {
        if selectedCategory == "All" {
            return templates
        }
        return templates.filter { $0.category == selectedCategory }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Template Library")
                        .font(.title.weight(.semibold))
                    Text("Choose a template to quickly set up a new managed loop. Note that machine-specific paths will need to be configured after creation.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Picker("View", selection: $isGridView) {
                    Image(systemName: "square.grid.2x2").tag(true)
                    Image(systemName: "list.bullet").tag(false)
                }
                .pickerStyle(.segmented)
                .frame(width: 100)
            }
            .padding()

            Divider()

            if !issues.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Template catalog issues", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout.weight(.semibold))
                    ForEach(issues.indices, id: \.self) { index in
                        Text(issues[index].message)
                            .font(.caption)
                    }
                }
                .foregroundStyle(LoopsPalette.warning)
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            // Explanation
            HStack(spacing: 16) {
                HStack {
                    Image(systemName: "sparkles")
                        .foregroundStyle(LoopsPalette.identity)
                    Text("**Copilot Loops** execute AI agents to reason over tasks.")
                        .font(.caption)
                }

                HStack {
                    Image(systemName: "terminal")
                        .foregroundStyle(LoopsPalette.operational)
                    Text("**Script Loops** run standard executable script files or binaries.")
                        .font(.caption)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            // Toolbar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(categories, id: \.self) { category in
                        Button(action: { selectedCategory = category }) {
                            Text(category)
                                .font(.subheadline)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(selectedCategory == category ? Color.accentColor : Color.secondary.opacity(0.1))
                                .foregroundStyle(selectedCategory == category ? Color.white : Color.primary)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }

            // Content
            ScrollView {
                if isGridView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 16)], spacing: 16) {
                        ForEach(filteredTemplates) { template in
                            TemplateCard(template: template, action: { handleSelection(template) })
                        }
                    }
                    .padding()
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredTemplates) { template in
                            TemplateRow(template: template, action: { handleSelection(template) })
                        }
                    }
                    .padding()
                }
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    private func handleSelection(_ template: LibraryTemplate) {
        if template.id == "blank-copilot" {
            onCreateBlank(.copilot)
        } else if template.id == "blank-script" {
            onCreateBlank(.script)
        } else {
            onUseTemplate(template.id)
        }
    }

    private func category(for key: String) -> String {
        if key.hasPrefix("blank-") { return "Blank" }
        if key == "nightly-dependency-report" { return "Reporting" }
        return "Maintenance"
    }

    private func icon(for key: String, kind: LoopKind) -> String {
        switch key {
        case "nightly-dependency-report": return "doc.text.magnifyingglass"
        case "repository-maintenance": return "wrench.and.screwdriver"
        case "scheduled-skill-review": return "brain.head.profile"
        case "blank-copilot": return "sparkles.rectangle"
        case "blank-script": return "terminal"
        default: return kind == .copilot ? "sparkles.rectangle" : "terminal"
        }
    }
}

struct TemplateCard: View {
    let template: LibraryTemplate
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(template.kind == .copilot ? LoopsPalette.identity.opacity(0.2) : LoopsPalette.operational.opacity(0.2))
                            .frame(width: 40, height: 40)

                        Image(systemName: template.icon)
                            .font(.system(size: 18))
                            .foregroundStyle(template.kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational)
                    }

                    Spacer()

                    LoopsStatusPill(
                        title: template.kind == .copilot ? "Copilot" : "Script",
                        systemImage: template.kind == .copilot ? "sparkles" : "terminal",
                        tint: template.kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational
                    )
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(template.name)
                        .font(.headline)
                        .lineLimit(1)

                    Text(template.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer(minLength: 0)
            }
            .padding()
            .frame(height: 160)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isHovered ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: isHovered ? 2 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

struct TemplateRow: View {
    let template: LibraryTemplate
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(template.kind == .copilot ? LoopsPalette.identity.opacity(0.2) : LoopsPalette.operational.opacity(0.2))
                        .frame(width: 40, height: 40)

                    Image(systemName: template.icon)
                        .font(.system(size: 18))
                        .foregroundStyle(template.kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(template.name)
                        .font(.headline)
                    Text(template.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer()

                LoopsStatusPill(
                    title: template.kind == .copilot ? "Copilot" : "Script",
                    systemImage: template.kind == .copilot ? "sparkles" : "terminal",
                    tint: template.kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational
                )

                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
                    .font(.caption.weight(.bold))
            }
            .padding()
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isHovered ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: isHovered ? 2 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

struct LibraryView_Previews: PreviewProvider {
    static var previews: some View {
        LibraryView(
            onUseTemplate: { _ in },
            onCreateBlank: { _ in }
        )
        .frame(width: 800, height: 600)
    }
}

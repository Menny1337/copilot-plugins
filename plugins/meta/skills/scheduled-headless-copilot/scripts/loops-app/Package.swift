// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CopilotLoops",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "LoopsModels", targets: ["LoopsModels"]),
        .library(name: "LoopsIdentity", targets: ["LoopsIdentity"]),
        .library(name: "LoopsClient", targets: ["LoopsClient"]),
        .executable(name: "CopilotLoops", targets: ["CopilotLoops"]),
        .executable(name: "CopilotLoopsSecrets", targets: ["CopilotLoopsSecrets"]),
    ],
    targets: [
        .target(name: "LoopsModels"),
        .target(name: "LoopsIdentity"),
        .target(name: "LoopsClient", dependencies: ["LoopsModels", "LoopsIdentity"]),
        .executableTarget(
            name: "CopilotLoops",
            dependencies: ["LoopsModels", "LoopsIdentity", "LoopsClient"]
        ),
        .executableTarget(
            name: "CopilotLoopsSecrets",
            dependencies: ["LoopsIdentity"],
            linkerSettings: [.linkedFramework("Security")]
        ),
        .executableTarget(
            name: "CopilotLoopsContractTests",
            dependencies: ["LoopsModels", "LoopsIdentity", "LoopsClient"],
            path: "ContractTests"
        ),
    ]
)

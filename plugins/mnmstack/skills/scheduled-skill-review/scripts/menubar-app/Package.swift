// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SkillReviewMenuBar",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "SkillReviewMenuBar", targets: ["SkillReviewMenuBar"])
    ],
    targets: [
        .executableTarget(name: "SkillReviewMenuBar")
    ]
)

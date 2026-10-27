import Foundation
import CoreFoundation

public enum LoopsIdentityError: LocalizedError, Equatable {
    case invalidStateRoot(String)
    case invalidHome(String)
    case unreadable(path: String, underlying: String)
    case invalidObject(path: String)
    case invalidSchemaVersion(path: String)
    case invalidProfile(path: String, value: String?)
    case missingNamespace(path: String)
    case invalidNamespace(path: String, value: String)

    public var errorDescription: String? {
        switch self {
        case .invalidStateRoot(let value):
            return "COPILOT_LOOPS_HOME must be an absolute path; got '\(value)'."
        case .invalidHome(let value):
            return "HOME must be an absolute path; got '\(value)'."
        case .unreadable(let path, let underlying):
            return "Identity profile at \(path) is unreadable: \(underlying)"
        case .invalidObject(let path):
            return "\(path) must contain a JSON object."
        case .invalidSchemaVersion(let path):
            return "\(path) schemaVersion must be 1."
        case .invalidProfile(let path, let value):
            return "\(path) profile must be \"default\" or \"custom\"; got \(value ?? "null")."
        case .missingNamespace(let path):
            return "\(path) custom profile requires namespace."
        case .invalidNamespace(let path, let value):
            return "\(path) namespace must contain at least three lowercase reverse-DNS segments; got '\(value)'."
        }
    }
}

public struct LoopsIdentity: Equatable, Sendable {
    public static let schemaVersion = 1
    public static let publicNamespace = "com.copilotplugins.copilot-loops"

    public let profile: String
    public let namespace: String
    public let configured: Bool
    public let sourcePath: String

    public var bundleIdentifier: String { namespace }
    public var appLabel: String { "\(namespace).app" }
    public var taskLabelPrefix: String { "\(namespace).task." }
    public var keychainService: String { "\(namespace).secrets" }
    public var dispatchQueuePrefix: String { namespace }

    public static func stateRoot(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        if let override = environment["COPILOT_LOOPS_HOME"] {
            guard override.hasPrefix("/") else {
                throw LoopsIdentityError.invalidStateRoot(override)
            }
            return URL(fileURLWithPath: override).standardizedFileURL
        }
        let home: URL
        if let configuredHome = environment["HOME"], !configuredHome.isEmpty {
            guard configuredHome.hasPrefix("/") else {
                throw LoopsIdentityError.invalidHome(configuredHome)
            }
            home = URL(fileURLWithPath: configuredHome)
        } else {
            home = FileManager.default.homeDirectoryForCurrentUser
        }
        return home
            .appendingPathComponent(".copilot", isDirectory: true)
            .appendingPathComponent("scheduled-tasks", isDirectory: true)
            .appendingPathComponent("copilot-loops", isDirectory: true)
    }

    public static func profileURL(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        try stateRoot(environment: environment)
            .appendingPathComponent("identity.json", isDirectory: false)
    }

    public static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> LoopsIdentity {
        let url = try profileURL(environment: environment)
        do {
            _ = try fileManager.attributesOfItem(atPath: url.path)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return LoopsIdentity(profile: "default", namespace: publicNamespace, configured: false, sourcePath: url.path)
        } catch {
            throw LoopsIdentityError.unreadable(path: url.path, underlying: error.localizedDescription)
        }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        } catch {
            throw LoopsIdentityError.unreadable(path: url.path, underlying: error.localizedDescription)
        }
        guard let config = object as? [String: Any] else {
            throw LoopsIdentityError.invalidObject(path: url.path)
        }
        guard let version = config["schemaVersion"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              version == NSNumber(value: schemaVersion) else {
            throw LoopsIdentityError.invalidSchemaVersion(path: url.path)
        }
        guard let profile = config["profile"] as? String,
              profile == "default" || profile == "custom" else {
            throw LoopsIdentityError.invalidProfile(
                path: url.path,
                value: config["profile"] as? String
            )
        }

        let namespace: String
        if profile == "default" {
            if let configuredNamespace = config["namespace"] {
                guard let value = configuredNamespace as? String, value == publicNamespace else {
                    throw LoopsIdentityError.invalidNamespace(
                        path: url.path,
                        value: String(describing: configuredNamespace)
                    )
                }
            }
            namespace = publicNamespace
        } else {
            guard let value = config["namespace"] as? String else {
                throw LoopsIdentityError.missingNamespace(path: url.path)
            }
            guard validNamespace(value) else {
                throw LoopsIdentityError.invalidNamespace(path: url.path, value: value)
            }
            namespace = value
        }

        return LoopsIdentity(
            profile: profile,
            namespace: namespace,
            configured: true,
            sourcePath: url.path
        )
    }

    private static func validNamespace(_ value: String) -> Bool {
        let segments = value.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 3 else { return false }
        return segments.allSatisfy { segment in
            guard let first = segment.first,
                  first.isASCII && first.isLowercase && first.isLetter,
                  let last = segment.last,
                  last.isASCII && (last.isLowercase || last.isNumber) else {
                return false
            }
            return segment.allSatisfy {
                $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-")
            }
        }
    }
}

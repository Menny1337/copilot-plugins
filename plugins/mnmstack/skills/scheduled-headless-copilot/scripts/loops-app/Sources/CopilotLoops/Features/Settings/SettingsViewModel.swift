import Foundation
import SwiftUI
import LoopsModels
import UserNotifications

public struct ManagedSecretItem: Hashable, Identifiable, Sendable {
    public var account: String
    public var loopID: String
    public var loopName: String?
    public var envName: String

    public var id: String { account }

    public init(account: String, loopID: String, loopName: String? = nil, envName: String) {
        self.account = account
        self.loopID = loopID
        self.loopName = loopName
        self.envName = envName
    }

    public static func == (lhs: ManagedSecretItem, rhs: ManagedSecretItem) -> Bool {
        lhs.account == rhs.account
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(account)
    }
}

@MainActor
public class SettingsViewModel: ObservableObject {
    @Published public var settings: AppSettings
    @Published public var showMenuBarIcon: Bool

    @Published public var isDirty: Bool = false
    @Published public var isSaving: Bool = false
    @Published public var error: String? = nil

    @Published public var notificationAuthStatus: UNAuthorizationStatus = .notDetermined
    @Published public var notificationDeliveryError: String? = nil
    @Published public var systemDiagnostics: [String: String] = [:]
    @Published public var managedSecrets: [ManagedSecretItem] = []

    @Published public var keychainHealth: String
    @Published public var keychainError: String?

    public var onSave: (AppSettings, Bool) async throws -> Void
    public var onRequestNotificationAuth: () async throws -> UNAuthorizationStatus
    public var onCheckNotificationAuth: () async -> UNAuthorizationStatus
    public var onOpenSystemSettings: () -> Void
    public var onDeleteSecret: (ManagedSecretItem) async throws -> Void
    public var onCopyDiagnostic: (String) -> Void
    public var onOpenPath: (String) -> Void

    private var initialSettings: AppSettings
    private var initialShowMenuBarIcon: Bool

    public init(
        settings: AppSettings,
        showMenuBarIcon: Bool,
        notificationAuthStatus: UNAuthorizationStatus = .notDetermined,
        notificationDeliveryError: String? = nil,
        systemDiagnostics: [String: String] = [:],
        managedSecrets: [ManagedSecretItem] = [],
        keychainHealth: String = "Not checked",
        keychainError: String? = nil,
        onSave: @escaping (AppSettings, Bool) async throws -> Void,
        onRequestNotificationAuth: @escaping () async throws -> UNAuthorizationStatus,
        onCheckNotificationAuth: @escaping () async -> UNAuthorizationStatus,
        onOpenSystemSettings: @escaping () -> Void,
        onDeleteSecret: @escaping (ManagedSecretItem) async throws -> Void,
        onCopyDiagnostic: @escaping (String) -> Void,
        onOpenPath: @escaping (String) -> Void
    ) {
        self.settings = settings
        self.initialSettings = settings
        self.showMenuBarIcon = showMenuBarIcon
        self.initialShowMenuBarIcon = showMenuBarIcon
        self.notificationAuthStatus = notificationAuthStatus
        self.notificationDeliveryError = notificationDeliveryError
        self.systemDiagnostics = systemDiagnostics
        self.managedSecrets = managedSecrets
        self.keychainHealth = keychainHealth
        self.keychainError = keychainError
        self.onSave = onSave
        self.onRequestNotificationAuth = onRequestNotificationAuth
        self.onCheckNotificationAuth = onCheckNotificationAuth
        self.onOpenSystemSettings = onOpenSystemSettings
        self.onDeleteSecret = onDeleteSecret
        self.onCopyDiagnostic = onCopyDiagnostic
        self.onOpenPath = onOpenPath
    }

    public func checkDirty() {
        isDirty = (settings != initialSettings) || (showMenuBarIcon != initialShowMenuBarIcon)
    }

    public func save() {
        Task {
            self.isSaving = true
            self.error = nil
            do {
                try await onSave(settings, showMenuBarIcon)
                self.initialSettings = self.settings
                self.initialShowMenuBarIcon = self.showMenuBarIcon
                self.isDirty = false
            } catch {
                self.error = error.localizedDescription
            }
            self.isSaving = false
        }
    }

    public func cancel() {
        self.settings = initialSettings
        self.showMenuBarIcon = initialShowMenuBarIcon
        self.error = nil
        self.isDirty = false
    }

    public func synchronize(
        settings: AppSettings,
        showMenuBarIcon: Bool,
        notificationAuthStatus: UNAuthorizationStatus,
        notificationDeliveryError: String?,
        systemDiagnostics: [String: String],
        managedSecrets: [ManagedSecretItem],
        keychainHealth: String,
        keychainError: String?
    ) {
        if !isDirty && !isSaving {
            self.settings = settings
            self.initialSettings = settings
            self.showMenuBarIcon = showMenuBarIcon
            self.initialShowMenuBarIcon = showMenuBarIcon
        }
        self.notificationAuthStatus = notificationAuthStatus
        self.notificationDeliveryError = notificationDeliveryError
        self.systemDiagnostics = systemDiagnostics
        self.managedSecrets = managedSecrets
        self.keychainHealth = keychainHealth
        self.keychainError = keychainError
    }

    public func requestAuth() {
        Task {
            do {
                let status = try await onRequestNotificationAuth()
                self.notificationAuthStatus = status
                self.error = nil
            } catch {
                self.error = "Failed to request notification auth: \(error.localizedDescription)"
            }
        }
    }

    public func checkAuth() {
        Task {
            let status = await onCheckNotificationAuth()
            self.notificationAuthStatus = status
            if status == .authorized || status == .provisional {
                if self.notificationDeliveryError == "Notifications are disabled in System Settings" {
                    self.notificationDeliveryError = nil
                }
            } else if status == .denied {
                self.notificationDeliveryError = "Notifications are disabled in System Settings"
            }
        }
    }

    public func deleteSecret(_ item: ManagedSecretItem) {
        Task {
            do {
                try await onDeleteSecret(item)
                self.managedSecrets.removeAll { $0.account == item.account }
            } catch {
                self.error = "Failed to delete secret: \(error.localizedDescription)"
            }
        }
    }
}

import Foundation
import LoopsIdentity
import Security

private let maximumSecretBytes = 1_048_576

private func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

private let service: String = {
    do {
        return try LoopsIdentity.load().keychainService
    } catch {
        fail("identity profile error: \(error.localizedDescription)", code: 2)
    }
}()

private func baseQuery(account: String) -> [CFString: Any] {
    [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
    ]
}

private func setSecret(account: String) {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { fail("secret value must not be empty", code: 2) }
    guard data.count <= maximumSecretBytes else {
        fail("secret value exceeds \(maximumSecretBytes) bytes", code: 2)
    }

    let query = baseQuery(account: account)
    let update: [CFString: Any] = [
        kSecValueData: data,
        kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
    ]
    var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
        var add = query
        update.forEach { add[$0.key] = $0.value }
        status = SecItemAdd(add as CFDictionary, nil)
    }
    guard status == errSecSuccess else {
        fail("keychain set failed: \(SecCopyErrorMessageString(status, nil) ?? "status \(status)" as CFString)")
    }
    FileHandle.standardOutput.write(Data("ok\n".utf8))
}

private func getSecret(account: String) {
    var query = baseQuery(account: account)
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
        fail("keychain get failed: \(SecCopyErrorMessageString(status, nil) ?? "status \(status)" as CFString)")
    }
    FileHandle.standardOutput.write(data)
}

private func secretExists(account: String) {
    var query = baseQuery(account: account)
    query[kSecReturnAttributes] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
        FileHandle.standardOutput.write(Data("false\n".utf8))
        return
    }
    guard status == errSecSuccess else {
        fail("keychain exists check failed: \(SecCopyErrorMessageString(status, nil) ?? "status \(status)" as CFString)")
    }
    FileHandle.standardOutput.write(Data("true\n".utf8))
}

private func deleteSecret(account: String) {
    let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        fail("keychain delete failed: \(SecCopyErrorMessageString(status, nil) ?? "status \(status)" as CFString)")
    }
    FileHandle.standardOutput.write(Data("ok\n".utf8))
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 2 else {
    fail("usage: CopilotLoopsSecrets <set|get|exists|delete> <loop-id:ENV_NAME>", code: 2)
}
let accountPattern = #"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?:[A-Za-z_][A-Za-z0-9_]*$"#
guard arguments[1].range(of: accountPattern, options: .regularExpression) != nil else {
    fail("account must use loop-id:ENV_NAME", code: 2)
}

switch arguments[0] {
case "set":
    setSecret(account: arguments[1])
case "get":
    getSecret(account: arguments[1])
case "exists":
    secretExists(account: arguments[1])
case "delete":
    deleteSecret(account: arguments[1])
default:
    fail("unknown command: \(arguments[0])", code: 2)
}

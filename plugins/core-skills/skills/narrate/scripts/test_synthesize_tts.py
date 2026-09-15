"""Offline regression suite: python3 -B -m unittest discover -s <scripts> -v.

All Azure, HTTP, and keychain interactions are mocked. One optional local-media
test uses installed ffmpeg/ffprobe to concatenate generated silence.
Only private temporary fixtures are written; no paid synthesis is performed.
"""

import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

import synthesize_tts as tts


ENDPOINT = "https://example.openai.azure.com"


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.script = self.root / "report.brief.narration.md"
        self.script.write_text("First sentence. Second sentence. Third sentence.", encoding="utf-8")
        self.output = self.root / "report.mp3"
        self.config = self.root / "config.toml"
        self.env = self.enterContext(mock.patch.dict(os.environ, {
            "AZURE_OPENAI_ENDPOINT": ENDPOINT,
            "NARRATE_CONFIG_PATH": str(self.config),
            "XDG_DATA_HOME": str(self.root / "data"),
        }, clear=True))
        self.run = self.enterContext(mock.patch.object(
            tts.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "")))
        self.which = self.enterContext(mock.patch.object(tts.shutil, "which", return_value="/mock/tool"))
        self.dependency = self.enterContext(mock.patch.object(tts.importlib.util, "find_spec", return_value=object()))
        self.check_capabilities = tts.check_ffmpeg_capabilities
        self.capabilities = self.enterContext(mock.patch.object(tts, "check_ffmpeg_capabilities"))
        self.key = self.enterContext(mock.patch.object(tts, "get_api_key", side_effect=AssertionError("keychain accessed")))
        self.token = self.enterContext(mock.patch.object(tts, "get_azure_bearer_token",
                                                        side_effect=AssertionError("token acquired")))
        self.backend = self.enterContext(mock.patch.dict(
            tts.BACKENDS, {"azure-openai": mock.Mock(side_effect=AssertionError("paid audio"))}))

    def cli(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = tts.main([str(arg) for arg in args])
        return code, stdout.getvalue(), stderr.getvalue()

    def synth_args(self, *flags):
        return tts.parse_synth_args([str(self.script), str(self.output), *map(str, flags)])

    def install_audio_mocks(self, seconds=10):
        def audio(chunk, path, **kwargs):
            path.write_bytes(b"mock-mp3:" + chunk.encode())
        synth = mock.Mock(side_effect=audio)
        tts.BACKENDS["azure-openai"] = synth
        self.token.side_effect = None
        self.token.return_value = "test-token"
        self.run.side_effect = lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, json.dumps({"format": {"duration": seconds}}) if command[0] == "ffprobe" else "", "")
        return synth

    def test_dry_run_offline_no_credentials_network_or_writes(self):
        code, out, err = self.cli(self.script, self.output, "--dry-run", "--auth-mode", "api-key",
                                  "--resume-dir", self.root / "cache")
        self.assertEqual(code, 0, err)
        self.assertIn("NOT checked", out)
        self.assertIn("estimate only", out)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.config.exists())
        self.assertFalse((self.root / "cache").exists())
        self.key.assert_not_called()
        self.token.assert_not_called()
        for call in self.run.call_args_list:
            self.assertEqual(call.args[0][0], "git")

    def test_dry_run_and_synthesis_reject_same_invalid_settings(self):
        cases = [
            ("--speed", "nan"), ("--speed", "inf"), ("--speed", ".249"),
            ("--speed", "4.1"), ("--voice", "invented"), ("--auth-mode", "unknown"),
            ("--model", "realtime"), ("--model", "other-tts"),
            ("--endpoint", "http://example.com"), ("--endpoint", "https://u:p@example.com"),
            ("--endpoint", "https://example.com/?key=secret"),
            ("--endpoint", "https://example.com:bad"),
            ("--max-chars", "4097"), ("--max-duration", "nan"),
            ("--max-duration", "0"), ("--preview-words", "501"),
        ]
        for flags in cases:
            with self.subTest(flags=flags):
                dry = self.cli(self.script, self.output, "--dry-run", *flags)
                real = self.cli(self.script, self.output, *flags)
                self.assertEqual(dry[0], 2)
                self.assertEqual(real[0], 2)
                self.assertEqual(dry[2], real[2])
        self.token.assert_not_called()

    def test_speed_limits_are_inclusive(self):
        for speed in (".25", "4"):
            self.assertEqual(self.cli(self.script, self.output, "--dry-run", "--speed", speed)[0], 0)

    def test_missing_tools_and_dependency_consistent(self):
        for missing in ("az", "ffmpeg", "ffprobe", "requests"):
            with self.subTest(missing=missing):
                self.which.side_effect = lambda name: None if name == missing else "/mock/tool"
                self.dependency.return_value = None if missing == "requests" else object()
                for mode in ([], ["--dry-run"]):
                    code, _, err = self.cli(self.script, self.output, *mode)
                    self.assertEqual(code, 2)
                    self.assertIn(missing, err)
        self.token.assert_not_called()

    def test_ffmpeg_capability_check_requires_setts(self):
        self.run.return_value = subprocess.CompletedProcess([], 0, "Bitstream filters:\nsetts\n", "")
        self.check_capabilities()
        self.assertEqual(self.run.call_args.args[0], ["ffmpeg", "-hide_banner", "-bsfs"])
        self.run.return_value = subprocess.CompletedProcess([], 0, "aac_adtstoasc\n", "")
        with self.assertRaisesRegex(tts.SetupError, "lacks the `setts`"):
            self.check_capabilities()
        self.run.return_value = subprocess.CompletedProcess([], 1, "", "cannot run")
        with self.assertRaisesRegex(tts.SetupError, "Cannot inspect"):
            self.check_capabilities()

    def test_missing_ffmpeg_capability_fails_before_credentials(self):
        self.capabilities.side_effect = tts.SetupError("ffmpeg lacks setts")
        for mode in ([], ["--dry-run"]):
            code, _, err = self.cli(self.script, self.output, *mode)
            self.assertEqual(code, 2)
            self.assertIn("setts", err)
        self.assertEqual(self.cli("doctor")[0], 2)
        self.token.assert_not_called()
        self.key.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_existing_empty_output_needs_force_in_both_modes(self):
        self.output.touch()
        for mode in ([], ["--dry-run"]):
            self.assertEqual(self.cli(self.script, self.output, *mode)[0], 2)
        self.assertEqual(self.cli(self.script, self.output, "--force", "--dry-run")[0], 0)

    def test_empty_missing_directory_and_unreadable_source(self):
        self.script.write_text("  \n")
        self.assertEqual(self.cli(self.script, self.output, "--dry-run")[0], 2)
        self.assertEqual(self.cli(self.root, self.output, "--dry-run")[0], 2)
        self.script.unlink()
        self.assertEqual(self.cli(self.script, self.output, "--dry-run")[0], 2)
        self.script.write_text("text")
        with mock.patch.object(Path, "read_text", side_effect=PermissionError("unreadable source")):
            code, _, err = self.cli(self.script, self.output, "--dry-run")
            self.assertEqual(code, 2)
            self.assertNotIn("Traceback", err)

    def test_output_extension_symlink_directory_and_parent_guards(self):
        self.assertEqual(self.cli(self.script, self.root / "out.wav", "--dry-run")[0], 2)
        link = self.root / "linked.mp3"
        link.symlink_to(self.script)
        self.assertEqual(self.cli(self.script, link, "--force", "--dry-run")[0], 2)
        directory = self.root / "directory.mp3"
        directory.mkdir()
        self.assertEqual(self.cli(self.script, directory, "--force", "--dry-run")[0], 2)
        self.assertEqual(self.cli(self.script, self.script / "out.mp3", "--dry-run")[0], 2)

    def test_repo_output_refused_even_with_git_unavailable(self):
        (self.root / ".git").mkdir()
        self.run.side_effect = FileNotFoundError()
        self.assertEqual(self.cli(self.script, self.output, "--dry-run")[0], 2)
        self.assertEqual(self.cli(self.script, self.output, "--dry-run", "--allow-tracked")[0], 0)

    def test_output_inference_and_machine_json(self):
        code, out, err = self.cli("output-path", self.root / "document.md")
        self.assertEqual(code, 0, err)
        paths = json.loads(out)
        self.assertEqual(paths["transcript"], str(self.root / "document.narration.md"))
        self.assertEqual(paths["audio"], str(self.root / "document.mp3"))
        paths = tts.output_paths(self.script)
        self.assertEqual(paths["audio"], self.root / "report.brief.mp3")
        self.assertEqual(paths["transcript"], self.script)
        self.assertEqual(self.cli(self.script, "--dry-run")[0], 0)

    def test_output_path_needs_neither_azure_config_nor_audio_dependencies(self):
        self.config.write_text("invalid TOML is irrelevant to path planning")
        self.which.return_value = None
        self.dependency.return_value = None
        del os.environ["AZURE_OPENAI_ENDPOINT"]
        with mock.patch.object(tts, "load_config", side_effect=AssertionError("config read")), \
                mock.patch.object(tts, "preflight_external_tools", side_effect=AssertionError("audio preflight")):
            code, out, err = self.cli("output-path", self.root / "not-yet-authored.md")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)["audio"], str(self.root / "not-yet-authored.mp3"))
        self.which.assert_not_called()
        self.dependency.assert_not_called()
        self.key.assert_not_called()
        self.token.assert_not_called()

    def test_repo_inference_stable_hash_and_override(self):
        (self.root / ".git").mkdir()
        first = tts.output_paths(self.script)
        self.assertEqual(first, tts.output_paths(self.script))
        self.assertNotEqual(first["audio"].parent, tts.output_paths(self.root / "other" / self.script.name)["audio"].parent)
        self.assertEqual(first["audio"].parents[1], self.root / "data" / "narrate" / "outputs")
        chosen = self.root / "chosen"
        self.assertEqual(tts.output_paths(self.script, chosen)["audio"], chosen / "report.brief.mp3")
        self.assertFalse(chosen.exists())

    def test_output_flag_wins_positional(self):
        args = self.synth_args("--output", self.root / "override.mp3")
        self.assertEqual(args.output, self.root / "override.mp3")

    def test_output_path_cannot_infer_audio_over_source(self):
        self.assertEqual(self.cli("output-path", self.root / "source.mp3")[0], 2)

    def test_force_never_overwrites_source_or_hardlink(self):
        original = self.script.read_bytes()
        code, _, _ = self.cli(self.script, self.script, "--force")
        self.assertEqual(code, 2)
        os.link(self.script, self.output)
        self.assertEqual(self.cli(self.script, self.output, "--force")[0], 2)
        self.assertEqual(self.script.read_bytes(), original)

    def test_model_identity_defaults_legacy_alias_and_supported_voices(self):
        s = tts.resolve_settings(config={"azure_openai": {"deployment": "production-voice"}})
        self.assertEqual(s.model, "tts-hd")
        tts.validate_settings(s)
        for model in tts.VALID_MODELS:
            for voice in tts.VALID_VOICES:
                tts.validate_settings(tts.Settings(endpoint=ENDPOINT, model=model, voice=voice))

    def test_presets_and_cli_env_config_precedence(self):
        cfg = {"azure_openai": {"voice": "echo", "speed": .8}}
        os.environ["NARRATE_TTS_VOICE"] = "onyx"
        os.environ["NARRATE_TTS_SPEED"] = ".7"
        self.assertEqual(tts.resolve_settings(config=cfg).voice, "onyx")
        preset = tts.resolve_settings(config=cfg, cli=self.synth_args("--preset", "calm"))
        self.assertEqual((preset.voice, preset.speed), ("shimmer", .9))
        override = tts.resolve_settings(config=cfg, cli=self.synth_args(
            "--preset", "calm", "--voice", "fable", "--speed", "1.2"))
        self.assertEqual((override.voice, override.speed), ("fable", 1.2))
        os.environ["NARRATE_TTS_SPEED"] = "not-a-number"
        self.assertEqual(tts.resolve_settings(cli_speed=1.1).speed, 1.1)

    def test_setup_manual_noninteractive_and_config_permissions(self):
        code, out, err = self.cli("setup", "--non-interactive", "--endpoint", ENDPOINT,
                                  "--deployment", "voice-prod", "--model", "tts", "--voice", "alloy",
                                  "--speed", ".8", "--auth-mode", "api-key", "--api-version", "test")
        self.assertEqual(code, 0, err)
        settings = tts.load_config(self.config)["azure_openai"]
        self.assertEqual(settings["deployment"], "voice-prod")
        self.assertEqual(settings["model"], "tts")
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        self.key.assert_not_called()
        self.token.assert_not_called()
        self.run.assert_not_called()

    def test_setup_refuses_overwrite_before_discovery_or_secrets(self):
        self.config.write_text("existing config")
        with mock.patch.object(tts, "keychain_set") as store:
            code, _, err = self.cli("setup", "--non-interactive", "--subscription", "sub",
                                    "--resource-group", "rg", "--account", "account",
                                    "--deployment", "alias")
            self.assertEqual(code, 2)
            self.assertIn("--force", err)
            self.assertEqual(self.config.read_text(), "existing config")
            self.run.assert_not_called()
            store.assert_not_called()

    def test_setup_force_and_interactive_decline_do_not_store_secret(self):
        tts.save_config({"azure_openai": {"endpoint": ENDPOINT}}, self.config)
        original = self.config.read_bytes()
        with mock.patch("builtins.input", side_effect=[""] * 7 + ["n"]), mock.patch.object(tts, "keychain_set") as store:
            code, _, _ = self.cli("setup", "--auth-mode", "api-key")
            self.assertEqual(code, 1)
            self.assertEqual(self.config.read_bytes(), original)
            store.assert_not_called()
        self.assertEqual(self.cli("setup", "--non-interactive", "--force")[0], 0)

    def metadata(self, model="tts-hd"):
        return [
            subprocess.CompletedProcess([], 0, json.dumps({"properties": {"endpoint": ENDPOINT}}), ""),
            subprocess.CompletedProcess([], 0, json.dumps({"properties": {"model": {"name": model}}}), ""),
        ]

    def test_setup_discovery_reads_model_not_alias_and_explicit_subscription(self):
        del os.environ["AZURE_OPENAI_ENDPOINT"]
        self.run.side_effect = self.metadata()
        code, _, err = self.cli("setup", "--non-interactive", "--subscription", "sub-id",
                                "--resource-group", "rg", "--account", "account",
                                "--deployment", "friendly-alias")
        self.assertEqual(code, 0, err)
        cfg = tts.load_config(self.config)["azure_openai"]
        self.assertEqual(cfg["model"], "tts-hd")
        self.assertEqual(cfg["deployment"], "friendly-alias")
        self.assertEqual(cfg["subscription"], "sub-id")
        self.assertEqual(len(self.run.call_args_list), 2)
        for call in self.run.call_args_list:
            command = call.args[0]
            self.assertIn("show", command)
            self.assertIn("--subscription", command)
            self.assertIn("sub-id", command)
            self.assertNotIn("set", command)
            self.assertNotIn("keys", command)

    def test_setup_rejects_unsupported_or_mismatched_discovered_model(self):
        for actual, explicit in (("realtime", None), ("tts", "tts-hd")):
            self.run.side_effect = self.metadata(actual)
            flags = ["--model", explicit] if explicit else []
            code, _, err = self.cli("setup", "--non-interactive", "--subscription", "sub",
                                    "--resource-group", "rg", "--account", "account",
                                    "--deployment", "tts-hd", *flags)
            self.assertEqual(code, 2)
            self.assertFalse(self.config.exists())
            self.assertTrue("Unsupported model" in err or "does not match" in err)

    def test_setup_discovery_refreshes_stale_config_but_not_explicit_overrides(self):
        del os.environ["AZURE_OPENAI_ENDPOINT"]
        tts.save_config({"azure_openai": {"endpoint": "https://old.example.com", "model": "tts"}},
                        self.config)
        self.run.side_effect = self.metadata()
        flags = ["setup", "--non-interactive", "--force", "--subscription", "sub",
                 "--resource-group", "rg", "--account", "account", "--deployment", "alias"]
        code, _, err = self.cli(*flags)
        self.assertEqual(code, 0, err)
        self.assertEqual(tts.load_config(self.config)["azure_openai"]["endpoint"], ENDPOINT)
        self.assertEqual(tts.load_config(self.config)["azure_openai"]["model"], "tts-hd")
        self.run.side_effect = self.metadata()
        self.assertEqual(self.cli(*flags, "--endpoint", "https://wrong.example.com")[0], 2)

    def test_setup_revalidates_interactively_edited_deployment(self):
        self.run.side_effect = self.metadata() + self.metadata("realtime")
        with mock.patch("builtins.input", side_effect=["", "other-alias", "", "", "", "", ""]):
            code, _, err = self.cli("setup", "--subscription", "sub", "--resource-group", "rg",
                                    "--account", "account", "--deployment", "original-alias")
        self.assertEqual(code, 2)
        self.assertIn("Unsupported model", err)
        self.assertFalse(self.config.exists())

    def test_config_save_no_force_rejects_concurrent_creation(self):
        self.config.write_text("other writer")
        with self.assertRaises(tts.SetupError):
            tts.save_config({"azure_openai": {"endpoint": ENDPOINT}}, self.config, overwrite=False)
        self.assertEqual(self.config.read_text(), "other writer")

    def test_doctor_token_only_never_claims_synthesis(self):
        self.token.side_effect = None
        self.token.return_value = "secret-token"
        code, out, err = self.cli("doctor")
        self.assertEqual(code, 0, err)
        self.assertIn("NOT proven", out)
        self.assertNotIn("secret-token", out)
        self.run.assert_not_called()

    def test_doctor_metadata_and_key_readiness(self):
        self.run.side_effect = self.metadata()
        self.key.side_effect = None
        self.key.return_value = ("secret", "env")
        code, out, err = self.cli("doctor", "--auth-mode", "api-key", "--subscription", "sub",
                                  "--resource-group", "rg", "--account", "account")
        self.assertEqual(code, 0, err)
        self.assertIn("key validity", out)
        self.assertEqual(len(self.run.call_args_list), 2)
        self.token.assert_not_called()
        self.key.return_value = (None, "missing")
        self.assertEqual(self.cli("doctor", "--auth-mode", "api-key")[0], 2)

    def test_config_show_redacted_without_keychain(self):
        os.environ["NARRATE_AZURE_OPENAI_API_KEY"] = "very-secret"
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://user:password@example.com/?key=secret"
        os.environ["NARRATE_AUTH_MODE"] = "api-key"
        code, out, err = self.cli("config", "show")
        self.assertEqual(code, 0, err)
        self.assertNotIn("very-secret", out)
        self.assertNotIn("password", out)
        self.assertNotIn("key=secret", out)
        self.key.assert_not_called()

    def test_preview_sentence_boundaries_and_word_cap(self):
        text = "One two. Three four five six seven eight."
        self.assertEqual(tts.preview_text(text, 4), "One two.")
        self.assertEqual(tts.preview_text("one two three four", 2), "one two")
        self.assertEqual(tts.preview_text('He said "hello." Then left.', 3), 'He said "hello."')
        self.assertEqual(tts.preview_text("  Complete sentence.\n", 60), "Complete sentence.")

    def test_preview_abbreviation_does_not_collapse_sample(self):
        self.assertEqual(
            tts.preview_text("Dr. Smith went to the store and bought many things.", 6),
            "Dr. Smith went to the store",
        )
        self.assertEqual(
            tts.preview_text("The U.S. economy grew last quarter by a wide margin overall.", 7),
            "The U.S. economy grew last quarter by",
        )

    def test_preview_saves_exact_transcript_and_preserves_source(self):
        synth = self.install_audio_mocks()
        before = self.script.read_bytes()
        code, out, err = self.cli(self.script, self.output, "--preview", "--preview-words", "3")
        self.assertEqual(code, 0, err)
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        self.assertTrue(preview.exists())
        self.assertFalse(self.output.exists())
        self.assertEqual(transcript.read_text(), synth.call_args.args[0])
        self.assertEqual(transcript.read_text(), "First sentence.")
        self.assertEqual(self.script.read_bytes(), before)
        self.assertIn("Actual duration: 10.00s", out)
        self.assertEqual(self.cli(self.script, self.output, "--preview")[0], 2)

    def test_preview_transcript_conflict_fails_before_paid_call(self):
        transcript = self.root / "report.preview.narration.md"
        transcript.write_text("keep")
        code, _, _ = self.cli(self.script, self.output, "--preview")
        self.assertEqual(code, 2)
        self.assertEqual(transcript.read_text(), "keep")
        self.token.assert_not_called()

    def test_preview_duration_failure_publishes_neither_artifact(self):
        self.install_audio_mocks(seconds=65)
        code, _, err = self.cli(self.script, self.output, "--preview", "--max-duration", "60")
        self.assertEqual(code, 2)
        self.assertIn("exceeds", err)
        self.assertFalse((self.root / "report.preview.mp3").exists())
        self.assertFalse((self.root / "report.preview.narration.md").exists())

    def test_preview_audio_race_rolls_back_new_transcript(self):
        self.install_audio_mocks()
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        publish = tts.publish_file

        def race(temporary, output, force):
            if output == preview:
                preview.write_bytes(b"other-writer")
            publish(temporary, output, force)

        with mock.patch.object(tts, "publish_file", side_effect=race):
            code, _, err = self.cli(self.script, self.output, "--preview")
        self.assertEqual(code, 2)
        self.assertIn("Output appeared", err)
        self.assertFalse(transcript.exists())
        self.assertEqual(preview.read_bytes(), b"other-writer")
        self.assertFalse(list(self.root.glob(".*.tmp")))

    def test_preview_failed_forced_publication_restores_previous_transcript(self):
        self.install_audio_mocks()
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        preview.write_bytes(b"previous-audio")
        transcript.write_text("previous script")
        publish = tts.publish_file

        def failure(temporary, output, force):
            if output == preview:
                raise PermissionError("simulated audio publication failure")
            publish(temporary, output, force)

        with mock.patch.object(tts, "publish_file", side_effect=failure):
            code, _, err = self.cli(self.script, self.output, "--preview", "--force")
        self.assertEqual(code, 2)
        self.assertIn("simulated", err)
        self.assertEqual(transcript.read_text(), "previous script")
        self.assertEqual(preview.read_bytes(), b"previous-audio")
        self.assertFalse(list(self.root.glob(".*.tmp")))

    def test_preview_rollback_preserves_concurrently_replaced_transcript(self):
        self.install_audio_mocks()
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        publish = tts.publish_file

        def failure(temporary, output, force):
            if output == preview:
                replacement = self.root / "replacement.md"
                replacement.write_text("other writer")
                os.replace(replacement, transcript)
                raise PermissionError("simulated audio failure")
            publish(temporary, output, force)

        with mock.patch.object(tts, "publish_file", side_effect=failure):
            code, _, err = self.cli(self.script, self.output, "--preview")
        self.assertEqual(code, 2)
        self.assertIn("changed concurrently", err)
        self.assertEqual(transcript.read_text(), "other writer")
        self.assertFalse(preview.exists())

    def test_preview_rollback_handles_concurrent_transcript_removal(self):
        self.install_audio_mocks()
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        publish = tts.publish_file

        def failure(temporary, output, force):
            if output == preview:
                transcript.unlink()
                raise PermissionError("simulated audio failure")
            publish(temporary, output, force)

        with mock.patch.object(tts, "publish_file", side_effect=failure):
            code, _, err = self.cli(self.script, self.output, "--preview")
        self.assertEqual(code, 2)
        self.assertIn("simulated audio failure", err)
        self.assertFalse(transcript.exists())
        self.assertFalse(preview.exists())

    def test_preview_rollback_failure_is_reported(self):
        self.install_audio_mocks()
        preview = self.root / "report.preview.mp3"
        transcript = self.root / "report.preview.narration.md"
        transcript.write_text("previous script")
        publish = tts.publish_file
        replace = os.replace

        def failure(temporary, output, force):
            if output == preview:
                raise PermissionError("simulated audio failure")
            publish(temporary, output, force)

        def fail_restore(source, destination):
            if destination == transcript and Path(source).read_text() == "previous script":
                raise PermissionError("simulated rollback failure")
            return replace(source, destination)

        with mock.patch.object(tts, "publish_file", side_effect=failure), \
                mock.patch.object(tts.os, "replace", side_effect=fail_restore):
            code, _, err = self.cli(self.script, self.output, "--preview", "--force")
        self.assertEqual(code, 2)
        self.assertIn("transcript rollback failed", err)
        self.assertFalse(preview.exists())

    def test_dry_run_warns_when_estimate_exceeds_duration_cap(self):
        self.script.write_text("word " * 3000)
        code, out, err = self.cli(self.script, self.output, "--dry-run", "--max-duration", "60")
        self.assertEqual(code, 0)
        self.assertIn("1200.0s", out)
        self.assertIn("WARNING: Estimated duration 1200.0s exceeds --max-duration 60s", err)
        self.token.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_word_duration_estimate_uses_speed(self):
        self.assertEqual(tts.estimate_minutes("word " * 150), 1)
        self.assertEqual(tts.estimate_minutes("word " * 150, 2), .5)

    def test_full_duration_cap_and_existing_output_preserved(self):
        self.install_audio_mocks(seconds=12)
        code, _, err = self.cli(self.script, self.output, "--max-duration", "12")
        self.assertEqual(code, 0, err)
        original = self.output.read_bytes()
        code, _, err = self.cli(self.script, self.output, "--max-duration", "11.99", "--force")
        self.assertEqual(code, 2)
        self.assertEqual(self.output.read_bytes(), original)
        self.assertFalse(list(self.root.glob(".*.tmp")))

    def test_audio_probe_decode_failures_and_invalid_duration(self):
        self.output.write_bytes(b"audio")
        for probe in (
            subprocess.CompletedProcess([], 1, "", "bad audio"),
            subprocess.CompletedProcess([], 0, "invalid-json", ""),
            subprocess.CompletedProcess([], 0, '{"format":{"duration":"nan"}}', ""),
            subprocess.CompletedProcess([], 0, '{"format":{"duration":"0"}}', ""),
        ):
            self.run.return_value = probe
            with self.assertRaises(tts.SetupError):
                tts.verify_audio(self.output)
        self.run.side_effect = [
            subprocess.CompletedProcess([], 0, '{"format":{"duration":"1"}}', ""),
            subprocess.CompletedProcess([], 0, "", "decoder errors"),
        ]
        with self.assertRaisesRegex(tts.SetupError, "decoding"):
            tts.verify_audio(self.output)

    def test_atomic_publish_race_never_overwrites_and_unique_temp(self):
        self.install_audio_mocks()
        part = self.root / "part.mp3"
        part.write_bytes(b"audio")
        seen = []
        def verification(path, max_duration=None):
            seen.append(path)
            self.output.write_bytes(b"other-writer")
            return 1
        with mock.patch.object(tts, "verify_audio", side_effect=verification):
            with self.assertRaises(tts.SetupError):
                tts.concat_mp3s([part], self.output)
        self.assertEqual(self.output.read_bytes(), b"other-writer")
        self.assertNotEqual(seen[0], self.output.with_suffix(".mp3.tmp"))
        self.assertFalse(seen[0].exists())
        with tts.unique_sibling(self.output) as one, tts.unique_sibling(self.output) as two:
            self.assertNotEqual(one, two)

    def test_resume_identity_invalidates_settings_content_chunking_preview(self):
        s = tts.resolve_settings()
        args = self.synth_args()
        baseline = tts.job_identity("text", s, args)
        self.assertNotEqual(baseline, tts.job_identity("different", s, args))
        for key, value in (("endpoint", "https://other.example.com"), ("model", "tts"),
                           ("deployment", "alias"), ("api_version", "different"),
                           ("voice", "echo"), ("speed", .9)):
            changed = tts.resolve_settings()
            setattr(changed, key, value)
            self.assertNotEqual(baseline, tts.job_identity("text", changed, args))
        for flags in (("--max-chars", "100"), ("--preview",), ("--preview", "--preview-words", "20")):
            self.assertNotEqual(baseline, tts.job_identity("text", s, self.synth_args(*flags)))
        with mock.patch.object(tts, "chunk_script", return_value=["te", "xt"]):
            self.assertNotEqual(baseline, tts.job_identity("text", s, args))
        args.backend = "future-backend"
        self.assertNotEqual(baseline, tts.job_identity("text", s, args))

    def test_resume_reuses_only_hashed_decodable_audio(self):
        synth = self.install_audio_mocks()
        cache = self.root / "cache"
        flags = [self.script, self.output, "--resume-dir", cache]
        code, out, err = self.cli(*flags)
        self.assertEqual(code, 0, err)
        self.assertEqual(synth.call_count, 1)
        self.assertEqual(self.cli(*flags)[0], 2)
        self.assertEqual(self.cli(*flags, "--force")[0], 0)
        self.assertEqual(synth.call_count, 1)
        job = next(cache.iterdir())
        self.assertIn(f"Resume job: {job}", out)
        manifest = (job / "manifest.json").read_text()
        self.assertNotIn("First sentence", manifest)
        self.assertNotIn("test-token", manifest)
        self.assertEqual(job.stat().st_mode & 0o777, 0o700)
        chunk = next(job.glob("part-*.mp3"))
        self.assertEqual(chunk.stat().st_mode & 0o777, 0o600)
        chunk.write_bytes(b"corrupt")
        self.assertEqual(self.cli(*flags, "--force")[0], 0)
        self.assertEqual(synth.call_count, 2)

    def test_resume_corrupt_decode_resynthesizes(self):
        self.install_audio_mocks()
        directory = self.root / "cache"
        with tts.resume_job(directory, "key", [self.script]) as job:
            part = job.directory / "part-00001.mp3"
            part.write_bytes(b"bad-audio")
            part.chmod(0o600)
            job.record(part)
            with mock.patch.object(tts, "verify_audio", side_effect=tts.SetupError("decoder error")):
                self.assertIsNone(job.reuse(1))

    def test_resume_failure_preserves_successful_chunks_and_unlocks(self):
        synth = self.install_audio_mocks()
        calls = 0
        def fail_second(chunk, path, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise tts.SetupError("simulated network failure")
            path.write_bytes(b"audio")
        synth.side_effect = fail_second
        cache = self.root / "cache"
        code, _, err = self.cli(self.script, self.output, "--resume-dir", cache, "--max-chars", "20")
        self.assertEqual(code, 2)
        job = next(cache.iterdir())
        self.assertTrue((job / "part-00001.mp3").exists())
        self.assertFalse((job / "part-00002.mp3").exists())
        self.assertFalse((job / ".lock").exists())
        self.assertFalse(self.output.exists())

    def test_resume_duration_failure_retains_chunks(self):
        self.install_audio_mocks(seconds=20)
        cache = self.root / "cache"
        self.assertEqual(self.cli(self.script, self.output, "--resume-dir", cache,
                                  "--max-duration", "10")[0], 2)
        job = next(cache.iterdir())
        self.assertTrue((job / "part-00001.mp3").exists())
        self.assertFalse(self.output.exists())

    def test_resume_lock_conflict_and_exact_recovery_message(self):
        with tts.resume_job(self.root / "cache", "key", [self.script]) as job:
            with self.assertRaisesRegex(tts.SetupError, "remove only this lock"):
                with tts.resume_job(self.root / "cache", "key", [self.script]):
                    self.fail("conflicting lock accepted")
            self.assertTrue((job.directory / ".lock").exists())
        self.assertFalse((job.directory / ".lock").exists())

    def test_resume_symlinks_permissions_hardlinks_and_collisions_rejected(self):
        public = self.root / "public"
        public.mkdir(mode=0o755)
        with self.assertRaises(tts.SetupError):
            with tts.resume_job(public, "key", [self.script]):
                self.fail("public cache accepted")
        link = self.root / "link"
        link.symlink_to(public, target_is_directory=True)
        with self.assertRaises(tts.SetupError):
            with tts.resume_job(link, "key", [self.script]):
                self.fail("symlink cache accepted")
        with self.assertRaises(tts.SetupError):
            with tts.resume_job(self.root, "key", [self.script]):
                self.fail("source collision accepted")
        with tts.resume_job(self.root / "private", "key", [self.script]) as job:
            part = job.directory / "part-00001.mp3"
            part.symlink_to(self.script)
            with self.assertRaises(tts.SetupError):
                job.reuse(1)
            part.unlink()
            os.link(self.script, part)
            with self.assertRaises(tts.SetupError):
                job.reuse(1)

    def test_resume_invalid_manifest_is_actionable(self):
        with tts.resume_job(self.root / "cache", "key", [self.script]) as job:
            job.manifest.write_text("{")
            job.manifest.chmod(0o600)
            with self.assertRaisesRegex(tts.SetupError, "Invalid resume manifest"):
                job.load()

    def test_retry_after_bounded_and_http_date(self):
        self.assertEqual(tts.retry_delay("10", 2), 10)
        self.assertEqual(tts.retry_delay("10000", 2), 60)
        self.assertEqual(tts.retry_delay("-3", 2), 0)
        self.assertEqual(tts.retry_delay("NaN", 2), 2)
        self.assertEqual(tts.retry_delay("bogus", 2), 2)
        with mock.patch.object(tts.time, "time", return_value=0):
            self.assertEqual(tts.retry_delay("Thu, 01 Jan 1970 00:00:10 GMT", 2), 10)

    def test_http_payload_uses_model_identity_and_retry_after(self):
        responses = [
            types.SimpleNamespace(status_code=429, headers={"Retry-After": "7"}, text="busy"),
            types.SimpleNamespace(status_code=200, content=b"audio"),
        ]
        requests = types.SimpleNamespace(post=mock.Mock(side_effect=responses), RequestException=RuntimeError)
        with mock.patch.dict(sys.modules, {"requests": requests}), mock.patch.object(tts.time, "sleep") as sleep:
            tts.synthesize_azure_openai("text", self.output, voice="nova", speed=1,
                endpoint=ENDPOINT, deployment="friendly-alias", model="tts-hd",
                api_version="version", auth_mode="api-key", api_key="test-key")
        self.assertEqual(requests.post.call_args.kwargs["json"]["model"], "tts-hd")
        self.assertIn("/friendly-alias/", requests.post.call_args.args[0])
        sleep.assert_called_once_with(7)
        self.assertEqual(self.output.read_bytes(), b"audio")

    def test_bearer_header_and_token_refresh(self):
        responses = [
            types.SimpleNamespace(status_code=401, text="denied"),
            types.SimpleNamespace(status_code=200, content=b"audio"),
        ]
        requests = types.SimpleNamespace(post=mock.Mock(side_effect=responses), RequestException=RuntimeError)
        token_provider = mock.Mock(return_value="test-token")
        with mock.patch.dict(sys.modules, {"requests": requests}):
            tts.synthesize_azure_openai("text", self.output, voice="nova", speed=1,
                endpoint=ENDPOINT, deployment="alias", api_version="version",
                auth_mode="bearer", token_provider=token_provider)
        self.assertEqual(requests.post.call_args.kwargs["headers"]["Authorization"], "Bearer test-token")
        token_provider.assert_any_call(force_refresh=True)

    def test_http_empty_response_and_expected_io_errors_surface(self):
        requests = types.SimpleNamespace(
            post=mock.Mock(return_value=types.SimpleNamespace(status_code=200, content=b"")),
            RequestException=RuntimeError)
        with mock.patch.dict(sys.modules, {"requests": requests}):
            with self.assertRaisesRegex(tts.SetupError, "empty body"):
                tts.synthesize_azure_openai("text", self.output, voice="nova", speed=1,
                    endpoint=ENDPOINT, deployment="alias", api_version="version",
                    auth_mode="api-key", api_key="test-key")
        self.install_audio_mocks()
        with mock.patch.object(tts, "verify_audio", side_effect=subprocess.TimeoutExpired("ffprobe", 180)):
            code, _, err = self.cli(self.script, self.output)
            self.assertEqual(code, 2)
            self.assertNotIn("Traceback", err)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "local media tools unavailable")
class LocalMediaTests(unittest.TestCase):
    def test_real_mux_probe_decode_and_duration_cap_without_azure(self):
        with tempfile.TemporaryDirectory(prefix="narrate-test-") as tmp:
            root = Path(tmp).resolve()
            part = root / "silence.mp3"
            subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                 "anullsrc=r=24000:cl=mono", "-t", "0.2", "-c:a", "libmp3lame", str(part)],
                capture_output=True, check=True, timeout=30,
            )
            single = root / "single.mp3"
            combined = root / "combined.mp3"
            first_duration = tts.concat_mp3s([part], single)
            combined_duration = tts.concat_mp3s([part, part], combined)
            self.assertGreater(first_duration, 0)
            self.assertGreater(combined_duration, first_duration)
            rejected = root / "rejected.mp3"
            with self.assertRaisesRegex(tts.SetupError, "exceeds"):
                tts.concat_mp3s([part, part], rejected, max_duration=.01)
            self.assertFalse(rejected.exists())
            self.assertFalse(list(root.glob(".*.tmp")))


if __name__ == "__main__":
    unittest.main()

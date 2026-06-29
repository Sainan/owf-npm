#!/usr/bin/env node

const tool = process.argv[2];
switch (tool) {
	default: {
		console.error("Syntax: openwf <download|install> <version>");
		process.exit(1);
	} break;

	case "download": case "install": {
		(async () => {
			let target = process.argv[3];
			if (!target) {
				console.log(`Syntax: openwf ${tool} <version>`);
				process.exit(1);
			}

			const fs = require("node:fs");
			const { getVersions, getVersionType, getShortId, TOOLS_REPLACEMENTS, downloadFile, downloadFileFromMega, downloadUpdatePatch } = require("./lib.js");

			let isFresh = !fs.existsSync("manifests/versions.html");
			if (isFresh) {
				console.log("Downloading versions list...");
			}
			let versions = await getVersions();
			let version;
			while (true) {
				version = versions.find(version => getShortId(version) == target);
				if (!version) {
					version = versions.find(version => version.near == target);
					if (version) {
						target = getShortId(version);
						console.log(`Assuming you meant ${target}`);
					}
				}
				if (version || isFresh) {
					break;
				}
				console.log("Refreshing versions list...");
				await fs.promises.unlink("manifests/versions.html");
				versions = await getVersions();
				isFresh = true;
			}
			if (!version) {
				console.log(`Unknown version: ${target}`);
				process.exit(1);
			}
			const type = getVersionType(version);

			let btConsent = false;
			if (type != "steam") {
				const yesno = require("yesno");
				btConsent = await yesno({
					question: "Would it be okay to use peer-to-peer networking (BitTorrent) for faster downloads? [Y/n]",
					defaultValue: true
				})
			}

			if (type == "steam" || type == "patch") {
				const ContentManifest = require("lean-and-mean-steam-user/components/content_manifest");
				const { fetchManifest, fetchDepotKey, downloadAndInstall, DEFAULT_HOSTS, sha1file }  = require("steam-manifest-tools");

				console.log(`Fetching manifest...`);
				const manifestId = type == "patch" ? version.attributes.base_manifest : version.id;
				const manifest = ContentManifest.parse(await fetchManifest("230411", manifestId));

				console.log(`Fetching depot key...`);
				let depotKey = await fetchDepotKey(manifest.depot_id);
				depotKey = Buffer.from(depotKey, "hex");

				let remaining_chunks;
				await fs.promises.mkdir("install", { recursive: true });
				await downloadAndInstall(
					manifest,
					depotKey,
					(num_chunks) => {
						remaining_chunks = num_chunks;
						if (remaining_chunks == 0) {
							console.log("Unpacking...");
						}
					},
					(path, host) => { console.log(`${path}: Downloading from ${host}`); },
					(path, status, host) => {
						console.log(`${path}: Got ${status}`);
						if (status == 200 && --remaining_chunks == 0) {
							console.log("Unpacking...");
						}
					},
					(path, err) => { console.log(`${path}: `, err); },
					DEFAULT_HOSTS,
					`install/${target}`
				);

				if (version.id in TOOLS_REPLACEMENTS) {
					const toolsReplacement = TOOLS_REPLACEMENTS[version.id];
					console.log(`Fetching Tools replacement...`);
					if (!fs.existsSync(`depot/${toolsReplacement.name}`) || await sha1file(`depot/${toolsReplacement.name}`) != toolsReplacement.sha1) {
						await downloadFileFromMega(toolsReplacement.mega, `depot/${toolsReplacement.name}`);
					}
					console.log(`Applying Tools replacement...`);
					const sz = require("7zip-min");
					await sz.unpack(`depot/${toolsReplacement.name}`, `install/${target}`);
				}
			} else {
				console.log(`Version type (${type}) not yet supported.`);
				process.exit(1);
			}
			if (type == "patch") {
				console.log("Fetching update patch...");
				const patchArchivePath = await downloadUpdatePatch(version, btConsent);

				console.log("Applying update patch...");
				const sz = require("7zip-min");
				if (patchArchivePath.endsWith(".wim.7z")) {
					await sz.unpack(patchArchivePath, "depot");
					const wimPath = patchArchivePath.substr(0, patchArchivePath.length - 3);
					{
						const { Wim } = require("wim-parser");
						const wim = await Wim.open(wimPath);
						const root = await wim.getRootDirectoryEntry();
						const targetDir = (await wim.listDirectory(root)).find(entry => entry.file_name == target);
						await wim.extract(targetDir, `install/${target}`);
						await wim.close();
					}
					await fs.promises.unlink(wimPath);
				} else {
					await sz.unpackSome(patchArchivePath, [target], "install");
				}
			}
			if (tool == "install") {
				console.log("Downloading Bootstrapper manifest...");
				const meta = await (await fetch("https://openwf.io/supplementals/client%20drop-in/meta")).json();

				console.log(meta.hotfix ? `Downloading Bootstrapper v${meta.version} ${meta.hotfix}...` : `Downloading Bootstrapper v${meta.version}...`);
				const gameMajor = parseInt(version.near.split(".")[0]);
				const dllName = gameMajor >= 29 ? "dwmapi.dll" : "wtsapi32.dll";
				await downloadFile(`https://openwf.io/supplementals/client%20drop-in/${meta.version}/dwmapi.dll`, `install/${target}/${dllName}`);
				if (meta.hotfix) {
					await fs.promises.mkdir(`install/${target}/OpenWF`, { recursive: true });
					await downloadFile(`https://openwf.io/supplementals/client%20drop-in/${meta.version}/${meta.hotfix}/Hotfix.owf`, `install/${target}/OpenWF/Hotfix.owf`);
				}

				if (type != "patch" && gameMajor >= 38 && process.platform == "win32") {
					if (!fs.existsSync(`install/${target}/OpenWF/sideloadify-cli.cache`)) {
						console.log("Downloading sideloadify-cli...");
						await downloadFile("https://github.com/Sainan/Sideloadify/releases/download/1.1.0/sideloadify-cli.exe", `install/${target}/OpenWF/sideloadify-cli.cache`);
					}
					await fs.promises.mkdir(`install/${target}/OpenWF`, { recursive: true });
					await fs.promises.rename(`install/${target}/OpenWF/sideloadify-cli.cache`, `install/${target}/OpenWF/sideloadify-cli.exe`);
					await new Promise(resolve => {
						const { spawn } = require("node:child_process");
						const ps = spawn(`install/${target}/OpenWF/sideloadify-cli.exe`, [`install/${target}/Warframe.x64.exe`], { stdio: "inherit" });
						ps.on("close", resolve);
					});
					await fs.promises.rename(`install/${target}/OpenWF/sideloadify-cli.exe`, `install/${target}/OpenWF/sideloadify-cli.cache`);
				}
			}
			console.log("All done.");
			process.exit(0);
		})();
	} break;
}

const fs = require("node:fs");

const getVersions = async () => {
	if (!fs.existsSync("manifests/versions.html")) {
		await fs.promises.mkdir("manifests", { recursive: true });
		await fs.promises.writeFile("manifests/versions.html", await (await fetch("https://about.openwf.io/versions")).text(), "utf-8");
	}
	const tableRegex = /<tr id="(?<id>[0-9\.]+)"(?<attributes>[^>]*)>[^<]+<td><code>[^<]+(?:<!--[^<]+)?<\/code><\/td>[^<]+<td>(?:.|&lt;)&nbsp;(?<near>[^<]+)<\/td>/gu;
	const attributesRegex = /data-(?<key>[^=]+)="(?<value>[^"]+)"/gu;
	const str = fs.readFileSync("manifests/versions.html", "utf-8");
	const versions = [];
	for (let version; version = tableRegex.exec(str)?.groups; ) {
		const attributesString = version.attributes;
		version.attributes = {};
		for (let attribute; attribute = attributesRegex.exec(attributesString)?.groups; ) {
			version.attributes[attribute.key.replaceAll("-", "_")] = attribute.value;
		}
		versions.push(version);
	}
	return versions;
};

const getVersionType = (version) => {
	if (version.attributes.magnet) {
		if (version.attributes.base_manifest) {
			return "patch";
		} else {
			if (version.attributes.langs) {
				return "dirty";
			} else {
				return "cafee";
			}
		}
	} else {
		return "steam";
	}
};

const getShortId = (version) => {
	if (!version.attributes.magnet) {
		return version.near + "-steam";
	}
	return version.id;
};

const downloadFile = async (url, out) => {
	const { Readable } = require("node:stream");
	const { body } = await fetch(url);
	await fs.promises.writeFile(out, Readable.fromWeb(body));
};

const downloadFileFromMega = async (url, out) => {
	const { File } = await import("megajs");
	const file = File.fromURL(url);
	await file.loadAttributes();
	//console.log(`Downloading ${file.name}...`);
	const data = await file.downloadBuffer();
	await fs.promises.writeFile(out, data);
};

// For single-file torrents, downloadDir is the folder that contains the file.
const verifyLocalTorrentDownload = (torrentFilePath, downloadDir, infoHash) => {
	return new Promise(resolve => {
		const nt = require("nt");
		nt.read(torrentFilePath, (_err, torrent) => {
			if (infoHash && torrent.infoHash() != infoHash) {
				throw new Error(`${torrentFilePath} does not seem to match infohash ${infoHash}`);
			}
			const hasher = torrent.hashCheck(downloadDir);
			let p;
			hasher.on("match", (i, hash, percent) => {
				p = percent;
			});
			hasher.on("end", () => {
				resolve(p == 100);
			});
		});
	});
};

const downloadUpdatePatch = async (version, btConsent) => {
	const params = new URLSearchParams(new URL(version.attributes.magnet).search);
	const infoHash = params.get("xt").substring(9);
	const torrentFilePath = `depot/${params.get("dn")}.torrent`;
	if (!fs.existsSync(torrentFilePath)) {
		const torrentFileUrl = `https://about.openwf.io/supplementals/torrents/patches/${params.get("dn")}.torrent`;
		await fs.promises.mkdir("depot", { recursive: true });
		await downloadFile(torrentFileUrl, torrentFilePath);
	}
	let needToDownload = !fs.existsSync(`depot/${params.get("dn")}`);
	while (true) {
		if (needToDownload) {
			if (btConsent) {
				const WebTorrent = (await import("webtorrent")).default;
				await new Promise(resolve => {
					const client = new WebTorrent();
					client.add(torrentFilePath, { path: "depot" }, torrent => {
						torrent.on("done", () => {
							client.destroy();
							resolve(`depot/${params.get("dn")}`);
						});
					});
				});
			} else {
				//await downloadFile(params.get("ws"), `depot/${params.get("dn")}`);
				await downloadFileFromMega(version.attributes.mega, `depot/${params.get("dn")}`);
			}
		}
		if (await verifyLocalTorrentDownload(torrentFilePath, "depot", infoHash)) {
			return `depot/${params.get("dn")}`;
		}
		if (needToDownload) {
			// This was a fresh download, no point in retrying.
			throw new Error(`Failed to download ${version.attributes.mega}`);
		}
		//console.log("File is locally available but failed to verify against .torrent");
		needToDownload = true;
	}
};

module.exports = { getVersions, getVersionType, getShortId, downloadFile, downloadFileFromMega, verifyLocalTorrentDownload, downloadUpdatePatch };

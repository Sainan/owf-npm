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

let WebTorrent;
const downloadSingleFileWebseededTorrent = async (magnetUri, btConsent) => {
	const params = new URLSearchParams(new URL(magnetUri).search);
	if (btConsent) {
		if (!WebTorrent) {
			WebTorrent = (await import("webtorrent")).default;
		}
		return new Promise(resolve => {
			const client = new WebTorrent();
			client.add(magnetUri, { path: "depot" }, torrent => {
				torrent.on("done", () => {
					client.destroy();
					resolve(`depot/${params.get("dn")}`);
				});
			});
		});
	} else {
		if (!fs.existsSync(`depot/${params.get("dn")}`)) {
			await fs.promises.mkdir("depot", { recursive: true });
			await downloadFile(params.get("ws"), `depot/${params.get("dn")}`);
		}
		// TODO: Use mega download because it's faster and more consistent than archive.org
		// TODO: Verify integrity via .torrent
		return `depot/${params.get("dn")}`;
	}
};
/*const downloadMultiFileWebseededTorrent = (magnetUri, torrentFileUrl, btConsent) => {
	// TODO
};*/

module.exports = { getVersions, getVersionType, getShortId, downloadFile, downloadSingleFileWebseededTorrent, /*downloadMultiFileWebseededTorrent*/ };

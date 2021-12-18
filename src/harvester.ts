import { BrowserWindow, BrowserView, net, ipcMain } from "electron";
import { initialize, enable } from "@electron/remote/main";
import * as fs from "fs";
import * as path from "path";

type HarvesterId = number;
type CaptchaToken = string;
interface HarvesterInfo {
	callback: (value: CaptchaToken | void) => void;
}

const HARVESTERS = new Map<HarvesterId, HarvesterInfo>();

const spawnHarvester = (): void => {
	initialize();

	const win = new BrowserWindow({
		width: 360,
		height: 650,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	enable(win.webContents);

	win.loadFile("../harvester.html");
};

const loadCaptcha = (id: HarvesterId): void => {
	const currentWindow = BrowserWindow.fromId(id);

	const view = new BrowserView({
		webPreferences: {
			partition: `persist:${id}`,
			nodeIntegration: true,
			contextIsolation: false,
		},
	});
	enable(view.webContents);

	currentWindow.setBrowserView(view);
	view.setBounds({ x: 10, y: 70, width: 320, height: 508 });

	view.webContents.session.protocol.interceptBufferProtocol(
		"https",
		(req, callback) => {
			if (req.url.startsWith("https://www.supremenewyork.com/")) {
				callback({
					mimeType: "text/html",
					data: fs.readFileSync(path.join(__dirname, "../captcha.html")),
				});

				view.webContents.session.protocol.uninterceptProtocol("https");
			} else {
				const request = net.request(req);
				request.on("response", (res) => {
					const chunks: Buffer[] = [];

					res.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});

					res.on("end", async () => {
						const file = Buffer.concat(chunks);
						callback(file);
					});
				});

				if (req.uploadData) {
					req.uploadData.forEach((part) => {
						if (part.bytes) {
							request.write(part.bytes);
						} else if (part.file) {
							request.write(fs.readFileSync(part.file));
						}
					});
				}

				request.end();
			}
		}
	);

	view.webContents.loadURL(`https://www.supremenewyork.com/`);
};

const openYoutube = (id: HarvesterId): void => {
	const win = new BrowserWindow({
		width: 500,
		height: 500,
		webPreferences: {
			partition: `persist:${id}`,
		},
	});

	win.loadURL("https://www.youtube.com");
};

const solveCaptcha = (id: HarvesterId): Promise<void> => {
	return new Promise((resolve: () => void) => {
		HARVESTERS.set(id, { callback: resolve });
		loadCaptcha(id);
	});
};

const removeCaptchaView = (currentWindow: BrowserWindow): void => {
	const currentView = currentWindow.getBrowserView();
	currentWindow.removeBrowserView(currentView);
};

const incrementSolvedCaptchas = (currentWindow: BrowserWindow): void => {
	currentWindow.webContents.executeJavaScript(`
		var el = document.getElementById('captchas-solved');
		var [currentValue] = /[0-9]+/gm.exec(el.innerText)
		el.innerHTML = el.innerHTML.replace(/[0-9]+/gm, Number(currentValue) + 1)
	`);
};

const startTask = async (id: HarvesterId): Promise<void> => {
	const token = await solveCaptcha(id);
	console.log(token);

	const currentWindow = BrowserWindow.fromId(id);
	removeCaptchaView(currentWindow);

	incrementSolvedCaptchas(currentWindow);
};

ipcMain.on("open-youtube", (event, id: HarvesterId) => openYoutube(id));
ipcMain.on("captcha-solved", (event, id: HarvesterId, token: CaptchaToken) => {
	const { callback } = HARVESTERS.get(id);

	callback(token);
});
ipcMain.on("start-task", (event, id: HarvesterId) => startTask(id));

export { spawnHarvester };

import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import { settingConst, verifyRecordType } from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import emailService from './email-service';
import accountService from './account-service';
import userService from './user-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n'
import verifyRecordService from './verify-record-service';

const settingService = {

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		// 添加错误处理，确保即使forwardRules格式错误也能正常处理
		try {
			console.log('refresh forwardRules:', settingRow.forwardRules);
			settingRow.forwardRules = JSON.parse(settingRow.forwardRules);
		} catch (error) {
			console.error('Error parsing forwardRules:', error);
			// 发生错误时设置为空数组
			settingRow.forwardRules = [];
			// 同时更新数据库中的无效数据
			await orm(c).update(setting).set({ forwardRules: '[]' }).run();
		}
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {
		const setting = await c.env.kv.get(KvConst.SETTING, { type: 'json' });
		let domainList = c.env.domain;
		if (typeof domainList === 'string') {
			throw new BizError(t('notJsonDomain'));
		}
		domainList = domainList.map(item => '@' + item);
		setting.domainList = domainList;
		return setting;
	},

	async get(c) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 12)}******` : null;
		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});
		params.resendTokens = JSON.stringify(resendTokens);
		if (params.forwardRules) { // If forwardRules exists in params, validate and stringify it
			try {
				// 验证forwardRules是数组格式
				if (!Array.isArray(params.forwardRules)) {
					console.error('forwardRules must be an array');
					params.forwardRules = '[]';
				} else {
					// 验证数组中的每个规则对象都有必要的字段
					const validRules = params.forwardRules.filter(rule => 
						rule && 
						typeof rule === 'object' &&
						typeof rule.name === 'string' &&
						typeof rule.pattern === 'string' &&
						typeof rule.targetEmail === 'string'
					);
					params.forwardRules = JSON.stringify(validRules);
				}
			} catch (error) {
				console.error('Error validating or stringifying forwardRules:', error);
				// 发生错误时设置为空数组
				params.forwardRules = '[]';
			}
		} else { // if not sent, make sure it is not overwritten to null
			delete params.forwardRules;
		}
		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async setBackground(c, params) {

		const settingRow = await this.query(c);

		let { background } = params

		if (background && !background.startsWith('http')) {

			if (!c.env.r2) {
				throw new BizError(t('noOsUpBack'));
			}

			if (!settingRow.r2Domain) {
				throw new BizError(t('noOsDomainUpBack'));
			}

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type
			});

		}

		if (settingRow.background) {
			try {
				await r2Service.delete(c, settingRow.background);
			} catch (e) {
				console.error(e)
			}
		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},



	async physicsDeleteAll(c) {
		await emailService.physicsDeleteAll(c);
		await accountService.physicsDeleteAll(c);
		await userService.physicsDeleteAll(c);
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c)

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefreshTime: settingRow.autoRefreshTime,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			loginOpacity: settingRow.loginOpacity,
			domainList:settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain
		};
	}
};

export default settingService;

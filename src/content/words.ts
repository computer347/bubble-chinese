/** A vocabulary item: characters (hanzi), pinyin with tone marks, and an English meaning. */
export interface Word {
  readonly h: string;
  readonly p: string;
  readonly e: string;
}

// HSK 1–2 words plus a few bubbly extras. Validated by tests/unit/content.test.ts.
const RAW: ReadonlyArray<readonly [string, string, string]> = [
  ['爱','ài','love'], ['八','bā','eight'], ['爸爸','bàba','dad'], ['杯子','bēizi','cup'], ['北京','Běijīng','Beijing'],
  ['不','bù','not'], ['菜','cài','dish; vegetable'], ['茶','chá','tea'], ['吃','chī','to eat'], ['出租车','chūzūchē','taxi'],
  ['打电话','dǎ diànhuà','to make a phone call'], ['大','dà','big'], ['电脑','diànnǎo','computer'], ['电视','diànshì','television'], ['电影','diànyǐng','film'],
  ['东西','dōngxi','thing'], ['读','dú','to read aloud'], ['对不起','duìbuqǐ','sorry'], ['多','duō','many'], ['多少','duōshao','how many; how much'],
  ['儿子','érzi','son'], ['二','èr','two'], ['饭店','fàndiàn','restaurant'], ['飞机','fēijī','airplane'], ['分钟','fēnzhōng','minute'],
  ['高兴','gāoxìng','glad'], ['工作','gōngzuò','work'], ['狗','gǒu','dog'], ['汉语','Hànyǔ','Chinese language'], ['好','hǎo','good'],
  ['喝','hē','to drink'], ['和','hé','and'], ['很','hěn','very'], ['后面','hòumiàn','behind'], ['回','huí','to return'],
  ['会','huì','can (a learned skill)'], ['火车站','huǒchēzhàn','train station'], ['家','jiā','home; family'], ['叫','jiào','to be called'], ['今天','jīntiān','today'],
  ['九','jiǔ','nine'], ['开','kāi','to open'], ['看','kàn','to look'], ['看见','kànjiàn','to see'], ['来','lái','to come'],
  ['老师','lǎoshī','teacher'], ['冷','lěng','cold'], ['里','lǐ','inside'], ['零','líng','zero'], ['六','liù','six'],
  ['妈妈','māma','mum'], ['买','mǎi','to buy'], ['猫','māo','cat'], ['没关系','méi guānxi','it doesn’t matter'], ['米饭','mǐfàn','cooked rice'],
  ['明天','míngtiān','tomorrow'], ['名字','míngzi','name'], ['哪','nǎ','which'], ['那','nà','that'], ['能','néng','can (be able to)'],
  ['你','nǐ','you'], ['年','nián','year'], ['女儿','nǚ’ér','daughter'], ['朋友','péngyou','friend'], ['漂亮','piàoliang','pretty'],
  ['苹果','píngguǒ','apple'], ['七','qī','seven'], ['钱','qián','money'], ['前面','qiánmiàn','in front'], ['请','qǐng','please'],
  ['去','qù','to go'], ['热','rè','hot'], ['人','rén','person'], ['认识','rènshi','to know (someone)'], ['三','sān','three'],
  ['商店','shāngdiàn','shop'], ['上','shàng','up; on'], ['上午','shàngwǔ','morning'], ['少','shǎo','few'], ['谁','shéi','who'],
  ['什么','shénme','what'], ['十','shí','ten'], ['时候','shíhou','time; moment'], ['是','shì','to be'], ['书','shū','book'],
  ['水','shuǐ','water'], ['水果','shuǐguǒ','fruit'], ['睡觉','shuìjiào','to sleep'], ['说话','shuōhuà','to speak'], ['四','sì','four'],
  ['岁','suì','years old'], ['他','tā','he'], ['她','tā','she'], ['太','tài','too (much)'], ['天气','tiānqì','weather'],
  ['听','tīng','to listen'], ['同学','tóngxué','classmate'], ['喂','wèi','hello (on the phone)'], ['我','wǒ','I; me'], ['我们','wǒmen','we'],
  ['五','wǔ','five'], ['喜欢','xǐhuan','to like'], ['下','xià','down; below'], ['下午','xiàwǔ','afternoon'], ['下雨','xià yǔ','to rain'],
  ['先生','xiānsheng','Mr.; sir'], ['现在','xiànzài','now'], ['想','xiǎng','to want; to think'], ['小','xiǎo','small'], ['小姐','xiǎojiě','Miss'],
  ['写','xiě','to write'], ['谢谢','xièxie','thank you'], ['星期','xīngqī','week'], ['学生','xuésheng','student'], ['学习','xuéxí','to study'],
  ['学校','xuéxiào','school'], ['一','yī','one'], ['衣服','yīfu','clothes'], ['医生','yīshēng','doctor'], ['医院','yīyuàn','hospital'],
  ['椅子','yǐzi','chair'], ['有','yǒu','to have'], ['月','yuè','month; moon'], ['在','zài','at; in'], ['再见','zàijiàn','goodbye'],
  ['怎么','zěnme','how'], ['怎么样','zěnmeyàng','how is it?'], ['这','zhè','this'], ['中国','Zhōngguó','China'], ['中午','zhōngwǔ','noon'],
  ['住','zhù','to live (somewhere)'], ['桌子','zhuōzi','table'], ['字','zì','written character'], ['昨天','zuótiān','yesterday'], ['坐','zuò','to sit'],
  ['做','zuò','to do; to make'], ['白','bái','white'], ['黑','hēi','black'], ['红','hóng','red'], ['大家','dàjiā','everyone'],
  ['非常','fēicháng','extremely'], ['咖啡','kāfēi','coffee'], ['快乐','kuàilè','joyful'], ['慢','màn','slow'], ['快','kuài','fast'],
  ['便宜','piányi','cheap'], ['贵','guì','expensive'], ['眼睛','yǎnjing','eye'], ['身体','shēntǐ','body; health'], ['生日','shēngrì','birthday'],
  ['手机','shǒujī','mobile phone'], ['跑步','pǎobù','to go running'], ['唱歌','chànggē','to sing'], ['跳舞','tiàowǔ','to dance'], ['游泳','yóuyǒng','to swim'],
  ['旅游','lǚyóu','to travel'], ['早上','zǎoshang','early morning'], ['晚上','wǎnshang','evening'], ['鱼','yú','fish'], ['鸡蛋','jīdàn','egg'],
  ['牛奶','niúnǎi','milk'], ['西瓜','xīguā','watermelon'], ['雪','xuě','snow'], ['太阳','tàiyáng','sun'], ['门','mén','door'],
  ['路','lù','road'], ['笑','xiào','to laugh; to smile'], ['懂','dǒng','to understand'], ['等','děng','to wait'], ['找','zhǎo','to look for'],
  ['新','xīn','new'], ['远','yuǎn','far'], ['近','jìn','near'], ['高','gāo','tall; high'], ['长','cháng','long'],
  ['累','lèi','tired'], ['忙','máng','busy'], ['泡泡','pàopao','bubble'], ['气球','qìqiú','balloon'], ['好运','hǎoyùn','good luck'],
  ['惊喜','jīngxǐ','surprise'], ['耐心','nàixīn','patience'], ['朋友们','péngyoumen','friends'], ['开心','kāixīn','happy'], ['加油','jiāyóu','keep going!']
];

export const WORDS: readonly Word[] = RAW.map(([h, p, e]) => ({ h, p, e }));

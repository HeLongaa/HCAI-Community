import { useMemo, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import {
  Aperture,
  BadgeDollarSign,
  Bell,
  Bookmark,
  Bot,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  Clock3,
  Code2,
  Download,
  FileText,
  Globe2,
  Heart,
  Image,
  LayoutDashboard,
  Languages,
  ListMusic,
  LogIn,
  Menu,
  MessageCircle,
  Mic2,
  MoreHorizontal,
  Music2,
  Pause,
  PenLine,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Search,
  Send,
  Share2,
  Shuffle,
  Sparkles,
  Star,
  Tags,
  Trophy,
  Upload,
  UserRound,
  UsersRound,
  Video,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import './index.css'

type Locale = 'en' | 'zh'
type Page =
  | 'home'
  | 'create'
  | 'chat'
  | 'image'
  | 'video'
  | 'explore'
  | 'engine'
  | 'tasks'
  | 'publish'
  | 'mine'
  | 'community'
  | 'inspiration'
  | 'points'
  | 'admin'
  | 'pricing'
  | 'api'
  | 'earn'
  | 'about'
  | 'playlist'
  | 'profile'
  | 'terms'
  | 'privacy'

type Track = {
  id: number
  title: string
  artist: string
  plays: string
  duration: string
  cover: string
  prompt: string
  lyrics: string[]
}

type Work = {
  title: string
  creator: string
  type: 'Image' | 'Video'
  views: string
  image: string
}

type Task = {
  id: number
  title: string
  category: string
  budget: string
  points: string
  status: string
  deadline: string
  proposals: number
  description: string
  publisher: string
  assignee: string
  requirements: string[]
  attachments: string[]
  privateBrief: string
  submission: string
  resultLinks: string[]
  reviewNote: string
  rights: string
}

type Post = {
  id: number
  title: string
  category: string
  author: string
  replies: number
  likes: string
  views: string
  votes: number
  tag: string
  solved: boolean
  excerpt: string
  body?: string
}

type InspirationItem = {
  title: string
  type: string
  source: string
  saves: string
  text: string
}

type LedgerEntry = [string, string, string, string]

type PublishDraft = {
  title: string
  category: string
  reward: string
  deadline: string
  visibility: string
  details: string
  rules: string
}

type LocalizedText = {
  en: string
  zh: string
}

type MarketplaceProfile = {
  id: string
  handle: string
  initials: string
  lane: 'maker' | 'publisher' | 'both'
  name: LocalizedText
  role: LocalizedText
  bio: LocalizedText
  tags: string[]
  zhTags: string[]
  categories: string[]
  languages: string[]
  stats: {
    score: number
    completed: number
    posted: number
    response: string
    acceptance: string
    earned: string
    paid: string
    rank: string
  }
  badges: LocalizedText[]
  portfolio: LocalizedText[]
  reviews: LocalizedText[]
}

type CommunityDraft = {
  title: string
  category: string
  excerpt: string
}

type SimulateAction = (message: string, ledger?: { description: string; delta: string }) => void

const copy = {
  en: {
    brand: 'MuseFlow',
    search: 'Search',
    home: 'Home',
    create: 'Create',
    chat: 'Chat',
    image: 'Image',
    video: 'Video',
    explore: 'Explore',
    engine: 'AI Task Engine',
    tasks: 'Tasks',
    publish: 'Publish',
    mine: 'My Tasks',
    community: 'Community',
    inspiration: 'Inspiration',
    points: 'Points',
    admin: 'Admin',
    pricing: 'Pricing',
    api: 'API',
    earn: 'Earn',
    about: 'About',
    library: 'Library',
    profile: 'Profile',
    liked: 'Liked',
    newPlaylist: 'New playlist',
    login: 'Login',
    getStarted: 'Get Started',
    heroTitle: 'Task Plaza',
    heroText: 'Post AI work, match makers, and discuss delivery in one place.',
    startCreating: 'Post a task',
    trending: 'Trending this week',
    radio: 'Listen with MuseFlow Radio',
    unlimitedStreaming: 'Unlimited streaming',
    freeDownloads: 'Free downloads',
    royaltyFree: 'Royalty free',
    noCopyright: 'No copyright issues',
    dashboardTitle: 'AI collaboration dashboard',
    engineTitle: 'AI Task Engine',
    engineSubtitle: 'Split requirements, match makers, estimate rewards, and turn rough ideas into actionable AI work.',
    publishTitle: 'Publish an AI request',
    mineTitle: 'My task desk',
    inspirationTitle: 'Inspiration Library',
    pointsTitle: 'Points & rewards',
    adminTitle: 'Admin Center',
    promptPlaceholder: 'Describe the song, image, video, or idea you want...',
    instrumental: 'Instrumental',
    lyrics: 'Lyrics',
    tools: 'Tools',
    createSong: 'Create song',
    createVoice: 'Create voice',
    textToSpeech: 'Text to speech',
    replaceFile: 'Replace file',
    random: 'Random',
    generate: 'Generate',
    generating: 'Generating',
    generated: 'Generated',
    chatTitle: 'AI Chat',
    chatSubtitle: 'Draft lyrics, prompts, briefs, and production ideas.',
    imageTitle: 'Image Studio',
    imageSubtitle: 'Generate covers, posters, avatars, product visuals, and references.',
    videoTitle: 'Video Studio',
    videoSubtitle: 'Build text-to-video, image-to-video, and music video concepts.',
    tasksTitle: 'Task Plaza',
    communityTitle: 'Creator Community',
    postTask: 'Post task',
    takeTask: 'Take task',
    submitWork: 'Submit work',
    newPost: 'New post',
    reply: 'Reply',
    share: 'Share',
    follow: 'Follow',
    songs: 'Songs',
    playlists: 'Playlists',
    images: 'Images',
    videos: 'Videos',
    posts: 'Posts',
    open: 'Open',
    inProgress: 'In Progress',
    submitted: 'Submitted',
    completed: 'Completed',
    cancelled: 'Cancelled',
    all: 'All',
    users: 'Users',
    sfx: 'SFX',
    billingYear: 'Yearly - save 34%',
    billingMonth: 'Monthly',
    contactSales: 'Contact sales',
    docs: 'View docs',
    terms: 'Terms',
    privacy: 'Privacy',
  },
  zh: {
    brand: 'MuseFlow',
    search: '搜索',
    home: '首页',
    create: '创作',
    chat: '对话',
    image: '图片',
    video: '视频',
    explore: '探索',
    engine: 'AI 任务引擎',
    tasks: '任务广场',
    publish: '发布需求',
    mine: '我的任务',
    community: '社区',
    inspiration: '灵感库',
    points: '积分奖励',
    admin: '管理中心',
    pricing: '价格',
    api: 'API',
    earn: '联盟推广',
    about: '关于我们',
    library: '音乐库',
    profile: '个人资料',
    liked: '已点赞',
    newPlaylist: '新建播放列表',
    login: '登录',
    getStarted: '免费开始',
    heroTitle: '任务广场',
    heroText: '发布 AI 需求，匹配创作者，在社区讨论与交付。',
    startCreating: '发布任务',
    trending: '本周趋势',
    radio: '用 MuseFlow Radio 收听',
    unlimitedStreaming: '无限流媒体播放',
    freeDownloads: '免费下载',
    royaltyFree: '免版税',
    noCopyright: '没有版权问题',
    dashboardTitle: 'AI 协作工作台',
    engineTitle: 'AI 任务引擎',
    engineSubtitle: '拆解需求、匹配创作者、估算奖励，并把粗略想法变成可执行的 AI 任务。',
    publishTitle: '发布 AI 需求',
    mineTitle: '我的任务工作台',
    inspirationTitle: '灵感库',
    pointsTitle: '积分与奖励',
    adminTitle: '管理中心',
    promptPlaceholder: '描述你想要的歌曲、图片、视频或创意...',
    instrumental: '伴奏',
    lyrics: '歌词',
    tools: '工具',
    createSong: '创作歌曲',
    createVoice: '创作声音',
    textToSpeech: '朗读文本',
    replaceFile: '更换文件',
    random: '随机',
    generate: '生成',
    generating: '生成中',
    generated: '已生成',
    chatTitle: 'AI 对话',
    chatSubtitle: '写歌词、优化提示词、生成需求和制作思路。',
    imageTitle: '图片工作台',
    imageSubtitle: '生成封面、海报、头像、产品图和参考图。',
    videoTitle: '视频工作台',
    videoSubtitle: '制作文生视频、图生视频和音乐视频概念。',
    tasksTitle: '任务广场',
    communityTitle: '创作者社区',
    postTask: '发布任务',
    takeTask: '接取任务',
    submitWork: '提交方案',
    newPost: '发帖',
    reply: '回复',
    share: '分享',
    follow: '关注',
    songs: '歌曲',
    playlists: '播放列表',
    images: '图片',
    videos: '视频',
    posts: '帖子',
    open: '开放中',
    inProgress: '进行中',
    submitted: '已提交',
    completed: '已完成',
    cancelled: '已取消',
    all: '全部',
    users: '用户',
    sfx: '音效',
    billingYear: '年付立减 34%',
    billingMonth: '月付',
    contactSales: '联系销售',
    docs: '查看文档',
    terms: '服务条款',
    privacy: '隐私政策',
  },
} satisfies Record<Locale, Record<string, string>>

const hasCjk = (value: string) => /[\u3400-\u9fff]/.test(value)

const isZhCopy = (t: Record<string, string>) => t.home === '首页'

const textFor = (t: Record<string, string>, en: string, zh: string) => (isZhCopy(t) ? zh : en)

const matchesLanguage = (value: string, isZh: boolean) => (isZh ? hasCjk(value) : !hasCjk(value))

const localizeText = (value: LocalizedText, t: Record<string, string>) => (isZhCopy(t) ? value.zh : value.en)

const profileTags = (profile: MarketplaceProfile, t: Record<string, string>) => (isZhCopy(t) ? profile.zhTags : profile.tags)

const findProfile = (handle: string) => marketplaceProfiles.find((profile) => profile.handle === handle)

const taskLanguageText = (task: Task) =>
  [task.title, task.description, task.privateBrief, task.submission, task.reviewNote, ...task.requirements].join(' ')

const postLanguageText = (post: Post) => [post.title, post.category, post.tag, post.excerpt, post.body ?? ''].join(' ')

const inspirationLanguageText = (item: InspirationItem) => [item.title, item.type, item.source, item.text].join(' ')

function localizedTasks(tasksToFilter: Task[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = tasksToFilter.filter((task) => matchesLanguage(taskLanguageText(task), isZh))
  return filtered.length ? filtered : tasksToFilter
}

function localizedPosts(postsToFilter: Post[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = postsToFilter.filter((post) => matchesLanguage(postLanguageText(post), isZh))
  return filtered.length ? filtered : postsToFilter
}

function localizedInspiration(items: InspirationItem[], t: Record<string, string>) {
  const isZh = isZhCopy(t)
  const filtered = items.filter((item) => matchesLanguage(inspirationLanguageText(item), isZh))
  return filtered.length ? filtered : items
}

function rankProfiles(lane: 'maker' | 'publisher') {
  return marketplaceProfiles
    .filter((profile) => profile.lane === lane || profile.lane === 'both')
    .sort((a, b) => {
      const aValue = lane === 'maker' ? a.stats.score + a.stats.completed * 12 : a.stats.score + a.stats.posted * 11
      const bValue = lane === 'maker' ? b.stats.score + b.stats.completed * 12 : b.stats.score + b.stats.posted * 11
      return bValue - aValue
    })
}

function profileMatchScore(profile: MarketplaceProfile, draft: PublishDraft) {
  const source = `${draft.title} ${draft.category} ${draft.details} ${draft.rules}`.toLowerCase()
  const tagHits = [...profile.tags, ...profile.zhTags].filter((tag) => source.includes(tag.toLowerCase()))
  const categoryHit = profile.categories.includes(draft.category)
  const broadHits = profile.categories.filter((category) => source.includes(category.toLowerCase()))
  const languageHit = hasCjk(source) && profile.languages.includes('中文')
  const score = Math.min(99, 54 + tagHits.length * 7 + (categoryHit ? 22 : 0) + broadHits.length * 5 + (languageHit ? 6 : 0) + Math.round(profile.stats.score / 80))
  return {
    profile,
    score,
    tags: tagHits.slice(0, 3),
    categoryHit,
    languageHit,
  }
}

function matchProfilesForDraft(draft: PublishDraft) {
  return marketplaceProfiles
    .filter((profile) => profile.lane === 'maker' || profile.lane === 'both')
    .map((profile) => profileMatchScore(profile, draft))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
}

function categoryLabel(category: string, t: Record<string, string>) {
  if (!isZhCopy(t)) return category
  const labels: Record<string, string> = {
    All: '全部',
    Music: '音乐',
    Image: '图片',
    Video: '视频',
    Voice: '配音',
    Prompt: '提示词',
    Design: '设计',
    Automation: '自动化',
    Questions: '问答',
    Tutorials: '教程',
    Showcase: '作品',
    Prompts: '提示词',
    Collaboration: '协作',
    'Task Recap': '任务复盘',
  }
  return labels[category] ?? category
}

function statusLabel(status: string, t?: Record<string, string>) {
  if (!t || !isZhCopy(t)) return status
  const labels: Record<string, string> = {
    Open: '开放中',
    'In Progress': '进行中',
    'Pending Review': '待验收',
    Completed: '已完成',
    Rejected: '已驳回',
    'Pending review': '待审核',
    Resubmission: '重新提交',
    'Community report': '社区举报',
    'Publish audit': '发布审核',
  }
  return labels[status] ?? status
}

function mediaTypeLabel(type: string, t: Record<string, string>) {
  if (!isZhCopy(t)) return type
  const labels: Record<string, string> = {
    Image: '图片',
    Video: '视频',
    Music: '音乐',
    Playlist: '播放列表',
  }
  return labels[type] ?? type
}

function localeFirstTask(tasksToFilter: Task[], t: Record<string, string>) {
  return localizedTasks(tasksToFilter, t)[0] ?? tasksToFilter[0]
}

function localeFirstPost(postsToFilter: Post[], t: Record<string, string>) {
  return localizedPosts(postsToFilter, t)[0] ?? postsToFilter[0]
}

const tracks: Track[] = [
  {
    id: 1,
    title: 'Summer Shoes',
    artist: 'michael_t',
    plays: '18K',
    duration: '03:12',
    cover:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=500&q=80',
    prompt:
      '70s retro pop, warm vintage vocals, minimal backing vocals, live drums, electric piano, smooth bassline, nostalgic summer story.',
    lyrics: ['You had those white summer shoes', 'Everybody knew them well', 'You wore them dancing every weekend'],
  },
  {
    id: 2,
    title: 'The Blue Camaro',
    artist: 'michael_t',
    plays: '20K',
    duration: '02:58',
    cover:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=500&q=80',
    prompt: 'Road-trip indie pop, blue hour guitars, bright chorus, analog tape warmth.',
    lyrics: ['We left the coast before the rain', 'Radio loud on an empty lane', 'Blue Camaro, take me home'],
  },
  {
    id: 3,
    title: 'Mil Mensajes',
    artist: 'dino_0',
    plays: '38K',
    duration: '03:40',
    cover:
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=500&q=80',
    prompt: 'Latin pop, late-night vocals, crisp drums, romantic synth hooks.',
    lyrics: ['Mil mensajes sin responder', 'Y tu nombre vuelve a aparecer', 'Bailamos lento hasta amanecer'],
  },
  {
    id: 4,
    title: 'Waterloo (cover)',
    artist: 'tylerjackson',
    plays: '10K',
    duration: '03:05',
    cover:
      'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=500&q=80',
    prompt: 'Classic pop cover, modern vocal stack, sunny piano and handclaps.',
    lyrics: ['You smiled across the crowded room', 'I knew the song before it bloomed', 'Waterloo in afternoon'],
  },
  {
    id: 5,
    title: 'Missed You By A Minute',
    artist: 'realashen',
    plays: '52K',
    duration: '03:28',
    cover:
      'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=500&q=80',
    prompt: 'Melodic R&B, breathy lead, lush pads, bittersweet late-night hook.',
    lyrics: ['I missed you by a minute', 'Saw your shadow in the door', 'Could not say what I came for'],
  },
  {
    id: 6,
    title: 'Tokyo Lofi',
    artist: 'yumi',
    plays: '41K',
    duration: '02:44',
    cover:
      'https://images.unsplash.com/photo-1493514789931-586cb221d7a7?auto=format&fit=crop&w=500&q=80',
    prompt: 'Lofi city pop, rain outside, vinyl texture, sleepy keys and mellow drums.',
    lyrics: ['Neon river, midnight train', 'Soft percussion in the rain', 'Tokyo whispers my name'],
  },
  {
    id: 7,
    title: 'Moonlit Support Queue',
    artist: 'chatnora',
    plays: '13K',
    duration: '02:36',
    cover:
      'https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?auto=format&fit=crop&w=500&q=80',
    prompt: 'Soft electronic focus music, clean plucks, warm pads, gentle support-desk rhythm.',
    lyrics: ['Tickets fade into the blue', 'Every answer finds a clue', 'Moonlit queue, I move with you'],
  },
  {
    id: 8,
    title: 'Brief Builder Bounce',
    artist: 'taskops',
    plays: '27K',
    duration: '02:21',
    cover:
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=500&q=80',
    prompt: 'Upbeat future funk for product work, tight bass, crisp snaps, playful synth hooks.',
    lyrics: ['Scope it once and ship it twice', 'Tiny notes make clean advice', 'Build the brief and roll the dice'],
  },
  {
    id: 9,
    title: '国风夜读',
    artist: 'musiccn',
    plays: '33K',
    duration: '02:49',
    cover:
      'https://images.unsplash.com/photo-1516541196182-6bdb0516ed27?auto=format&fit=crop&w=500&q=80',
    prompt: '国风 Lo-fi，古筝点缀，低保真鼓点，夜晚自习室氛围，轻微黑胶噪声。',
    lyrics: ['灯影落在书页旁', '风吹旧城月微凉', '一拍一念慢慢长'],
  },
  {
    id: 10,
    title: 'Launch Room Pulse',
    artist: 'clipcraft',
    plays: '46K',
    duration: '03:02',
    cover:
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=500&q=80',
    prompt: 'Modern launch trailer bed, confident drums, airy synth brass, product reveal energy.',
    lyrics: ['Screens awake, the room is bright', 'Ship the spark into the night', 'Launch room pulse, we take the flight'],
  },
  {
    id: 11,
    title: '字幕里的光',
    artist: 'voicelee',
    plays: '19K',
    duration: '02:55',
    cover:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=500&q=80',
    prompt: '中文广告配乐，温暖钢琴，轻快鼓组，适合课程口播和字幕节奏。',
    lyrics: ['第一句先抓住目光', '每个字都有方向', '字幕里藏着光'],
  },
  {
    id: 12,
    title: 'Prompt Rain Sketch',
    artist: 'stillcole',
    plays: '24K',
    duration: '03:18',
    cover:
      'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fit=crop&w=500&q=80',
    prompt: 'Indie pop demo, rain texture, bright chorus hook, prompt-writing montage energy.',
    lyrics: ['I wrote the weather in a line', 'Turned the chorus into signs', 'Prompt rain sketch, the melody aligns'],
  },
]

const radioStations = [
  {
    title: 'Smooth Relaxing Jazz',
    host: 'aurelleus',
    listeners: '597',
    image:
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Chill Lounge',
    host: 'mercury',
    listeners: '1.5K',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Afro Sunset Lounge',
    host: 'ohayes',
    listeners: '5.5K',
    image:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Gaming FM',
    host: 'anna_00',
    listeners: '5.7K',
    image:
      'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80',
  },
]

const visualWorks: Work[] = [
  {
    title: 'Solar Bloom Cover',
    creator: 'iriswood',
    type: 'Image',
    views: '24K',
    image:
      'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Neon Runner Teaser',
    creator: 'veyn',
    type: 'Video',
    views: '31K',
    image:
      'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Glass Product Pack',
    creator: 'mila_aurora',
    type: 'Image',
    views: '12K',
    image:
      'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Course Cover Matrix',
    creator: 'brandmuse',
    type: 'Image',
    views: '18K',
    image:
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Chatbot Flow Preview',
    creator: 'datahan',
    type: 'Video',
    views: '9.4K',
    image:
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Beauty Product Prompt Set',
    creator: 'iriswood',
    type: 'Image',
    views: '22K',
    image:
      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'Launch Shorts Pack',
    creator: 'clipcraft',
    type: 'Video',
    views: '36K',
    image:
      'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=700&q=80',
  },
  {
    title: 'AI 模特图改稿样张',
    creator: 'brandmuse',
    type: 'Image',
    views: '15K',
    image:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=700&q=80',
  },
]

const marketplaceProfiles: MarketplaceProfile[] = [
  {
    id: 'iriswood',
    handle: 'iriswood',
    initials: 'IW',
    lane: 'maker',
    name: { en: 'Iris Wood', zh: '林 Iris' },
    role: { en: 'Image systems maker', zh: 'AI 视觉系统创作者' },
    bio: {
      en: 'Builds consistent cover systems, product visuals, and reusable prompt recipes for brand teams.',
      zh: '擅长把封面、产品图和品牌视觉整理成可复用的提示词系统。',
    },
    tags: ['Image generation', 'Album covers', 'Prompt recipes', 'Brand systems', 'Figma boards'],
    zhTags: ['AI 生图', '封面系统', '提示词配方', '品牌视觉', 'Figma 看板'],
    categories: ['Image', 'Design', 'Prompt'],
    languages: ['EN', '中文'],
    stats: { score: 982, completed: 38, posted: 4, response: '12m', acceptance: '97%', earned: '28K pts', paid: '$8.4K', rank: 'Top 1%' },
    badges: [
      { en: 'Fast preview boards', zh: '快速预览看板' },
      { en: 'High reuse rate', zh: '高复用率' },
    ],
    portfolio: [
      { en: 'Lofi cover prompt pack with 20 visual directions', zh: 'Lo-fi 封面提示词包，包含 20 个视觉方向' },
      { en: 'Beauty product lighting and layout prompt matrix', zh: '美妆产品图布光与构图提示词矩阵' },
    ],
    reviews: [
      { en: 'Clear style lock, tidy files, and very easy to reuse.', zh: '风格锁定清楚，文件整洁，后续很容易复用。' },
      { en: 'Great at explaining why a prompt works.', zh: '很会解释提示词为什么有效。' },
    ],
  },
  {
    id: 'veyn',
    handle: 'veyn',
    initials: 'VY',
    lane: 'maker',
    name: { en: 'Veyn Studio', zh: 'Veyn 工作室' },
    role: { en: 'Video and automation producer', zh: '视频与自动化交付者' },
    bio: {
      en: 'Turns product briefs into short videos, ad workflows, revision logs, and repeatable delivery packs.',
      zh: '把产品需求拆成短视频、广告工作流、修改记录和可复用交付包。',
    },
    tags: ['Text to video', 'Ad workflow', 'Automation', 'Revision logs', 'Product shots'],
    zhTags: ['文生视频', '广告工作流', '自动化', '修改记录', '产品镜头'],
    categories: ['Video', 'Automation', 'Image'],
    languages: ['EN', '中文'],
    stats: { score: 921, completed: 31, posted: 2, response: '18m', acceptance: '93%', earned: '23K pts', paid: '$6.9K', rank: 'Top 3%' },
    badges: [
      { en: 'Milestone delivery', zh: '里程碑交付' },
      { en: 'Workflow builder', zh: '工作流搭建' },
    ],
    portfolio: [
      { en: 'Image ad workflow for five e-commerce categories', zh: '覆盖五个电商品类的图片广告工作流' },
      { en: 'Launch video storyboard, captions, and prompt notes', zh: '发布视频分镜、字幕与提示词说明' },
    ],
    reviews: [
      { en: 'Strong structure and honest failure-case notes.', zh: '结构强，也会诚实补充失败场景。' },
      { en: 'Best when the acceptance checklist is precise.', zh: '验收清单越明确，交付越稳。' },
    ],
  },
  {
    id: 'n8than',
    handle: 'n8than',
    initials: 'N8',
    lane: 'both',
    name: { en: 'Nathan Q.', zh: 'Nathan Q.' },
    role: { en: 'Voice cleanup and task pricing advisor', zh: '配音清理与任务定价顾问' },
    bio: {
      en: 'Specializes in voice cleanup, narrator matching, rights notes, and practical marketplace pricing.',
      zh: '擅长配音清理、旁白匹配、版权说明和任务定价建议。',
    },
    tags: ['Voice cleanup', 'Narrator matching', 'Pricing', 'Rights notes', 'QA'],
    zhTags: ['配音清理', '旁白匹配', '定价', '版权说明', '验收'],
    categories: ['Voice', 'Prompt'],
    languages: ['EN'],
    stats: { score: 884, completed: 27, posted: 9, response: '22m', acceptance: '98%', earned: '19K pts', paid: '$5.7K', rank: 'Top 4%' },
    badges: [
      { en: 'Accepted voice packs', zh: '配音交付高通过' },
      { en: 'Helpful forum answers', zh: '高质量社区回答' },
    ],
    portfolio: [
      { en: '12-minute narrator cleanup with A/B comparison', zh: '12 分钟旁白清理与 A/B 对比' },
      { en: 'Pricing framework for milestone task delivery', zh: '按里程碑拆分的任务定价框架' },
    ],
    reviews: [
      { en: 'Rights notes were exactly what the publisher needed.', zh: '版权说明刚好解决发布方担心的问题。' },
      { en: 'Very reliable on education voice projects.', zh: '教育类配音项目很可靠。' },
    ],
  },
  {
    id: 'stillcole',
    handle: 'stillcole',
    initials: 'SC',
    lane: 'maker',
    name: { en: 'Cole Still', zh: 'Cole Still' },
    role: { en: 'Music prompt architect', zh: '音乐提示词架构师' },
    bio: {
      en: 'Writes structured music prompts, QA checklists, chorus hooks, and reusable pack templates.',
      zh: '整理音乐提示词、质量检查清单、副歌钩子和可复用模板包。',
    },
    tags: ['Music prompts', 'Prompt QA', 'Lyrics', 'Genre maps', 'Template packs'],
    zhTags: ['音乐提示词', '提示词质检', '歌词', '风格图谱', '模板包'],
    categories: ['Music', 'Prompt'],
    languages: ['EN'],
    stats: { score: 846, completed: 24, posted: 5, response: '26m', acceptance: '94%', earned: '16K pts', paid: '$4.2K', rank: 'Top 6%' },
    badges: [
      { en: 'Prompt library builder', zh: '提示词库搭建' },
      { en: 'Chorus hook specialist', zh: '副歌钩子专家' },
    ],
    portfolio: [
      { en: '40-prompt AI music pack with QA checklist', zh: '40 条 AI 音乐提示词包与质检清单' },
      { en: 'Reusable chorus hook prompt stack', zh: '可复用副歌钩子提示词链路' },
    ],
    reviews: [
      { en: 'Clean taxonomy, quick examples, and useful negative prompts.', zh: '分类清楚、样例快、负面提示词实用。' },
      { en: 'Great for turning vague moods into usable prompts.', zh: '很适合把模糊情绪变成可用提示词。' },
    ],
  },
  {
    id: 'yumi',
    handle: 'yumi',
    initials: 'YU',
    lane: 'maker',
    name: { en: 'Yumi Chen', zh: '陈 Yumi' },
    role: { en: 'Music and image-to-video creator', zh: '音乐与图生视频创作者' },
    bio: {
      en: 'Creates lofi loops, image-to-video lyric clips, and polished showcase posts for community reuse.',
      zh: '制作 Lo-fi 循环、图生视频歌词片段，并整理适合社区复用的作品说明。',
    },
    tags: ['Music', 'Image to video', 'Lofi', 'Showcase posts', 'Captions'],
    zhTags: ['音乐', '图生视频', 'Lo-fi', '作品帖', '字幕'],
    categories: ['Music', 'Video'],
    languages: ['EN', '中文'],
    stats: { score: 808, completed: 22, posted: 7, response: '31m', acceptance: '95%', earned: '14K pts', paid: '$3.8K', rank: 'Top 8%' },
    badges: [
      { en: 'Showcase favorite', zh: '作品展示精选' },
      { en: 'Audio loop delivery', zh: '音频循环交付' },
    ],
    portfolio: [
      { en: 'City-pop image-to-video lyric loop', zh: 'City-pop 图生视频歌词循环' },
      { en: 'Guofeng lofi intro with reusable prompt notes', zh: '国风 Lo-fi 片头与可复用提示词说明' },
    ],
    reviews: [
      { en: 'Great taste and readable delivery notes.', zh: '审美好，交付说明也读得懂。' },
      { en: 'Strong at turning small assets into moving clips.', zh: '很会把小素材做成动态片段。' },
    ],
  },
  {
    id: 'voicelee',
    handle: 'voicelee',
    initials: 'VL',
    lane: 'maker',
    name: { en: 'Voice Lee', zh: '李声远' },
    role: { en: 'Chinese AI voice producer', zh: '中文 AI 配音交付者' },
    bio: {
      en: 'Delivers Chinese voice variants, SRT captions, pronunciation notes, and platform-specific voice guidance.',
      zh: '交付中文配音多版本、SRT 字幕、发音说明和平台投放语气建议。',
    },
    tags: ['Chinese voiceover', 'SRT captions', 'Pronunciation', 'Ad hooks', 'Education'],
    zhTags: ['中文配音', 'SRT 字幕', '发音校对', '广告钩子', '教育课程'],
    categories: ['Voice', 'Video'],
    languages: ['中文'],
    stats: { score: 792, completed: 19, posted: 1, response: '16m', acceptance: '96%', earned: '11K pts', paid: '¥18K', rank: 'Top 9%' },
    badges: [
      { en: 'Mandarin delivery', zh: '普通话交付' },
      { en: 'Caption-ready', zh: '字幕齐备' },
    ],
    portfolio: [
      { en: 'Three Chinese ad voice variants with SRT files', zh: '三版中文广告配音与 SRT 字幕' },
      { en: 'Pronunciation checklist for course campaigns', zh: '课程投放发音校对清单' },
    ],
    reviews: [
      { en: 'The pronunciation notes saved a revision round.', zh: '发音说明帮我们少改了一轮。' },
      { en: 'Very fast for Chinese course ads.', zh: '中文课程广告交付速度很快。' },
    ],
  },
  {
    id: 'promptlin',
    handle: 'promptlin',
    initials: 'PL',
    lane: 'both',
    name: { en: 'Prompt Lin', zh: '林 Prompt' },
    role: { en: 'Acceptance criteria and prompt template writer', zh: '验收标准与提示词模板作者' },
    bio: {
      en: 'Writes acceptance rules, resubmission notes, prompt templates, and concise task communication.',
      zh: '撰写验收规则、二次提交说明、提示词模板和简洁任务沟通文案。',
    },
    tags: ['Acceptance criteria', 'Resubmission', 'Prompt templates', 'Task copy', 'QA'],
    zhTags: ['验收标准', '二次提交', '提示词模板', '任务文案', '质检'],
    categories: ['Prompt', 'Automation'],
    languages: ['EN', '中文'],
    stats: { score: 766, completed: 17, posted: 13, response: '14m', acceptance: '91%', earned: '9K pts', paid: '¥9.6K', rank: 'Top 11%' },
    badges: [
      { en: 'Clear acceptance notes', zh: '验收说明清晰' },
      { en: 'Template contributor', zh: '模板贡献者' },
    ],
    portfolio: [
      { en: 'Resubmission template for rejected AI tasks', zh: 'AI 任务被驳回后的二次提交说明模板' },
      { en: 'Acceptance checklist for image, video, and automation work', zh: '图片、视频、自动化任务验收清单' },
    ],
    reviews: [
      { en: 'Concise, polite, and easy to paste into a task update.', zh: '简洁礼貌，可以直接粘贴到任务更新里。' },
      { en: 'Best for turning messy feedback into next steps.', zh: '很擅长把混乱反馈整理成下一步。' },
    ],
  },
  {
    id: 'launchteam',
    handle: 'launchteam',
    initials: 'LT',
    lane: 'publisher',
    name: { en: 'Launch Team', zh: 'Launch Team' },
    role: { en: 'Product campaign publisher', zh: '产品营销需求方' },
    bio: {
      en: 'Posts scoped launch-video tasks with brand assets, review windows, and commercial usage notes.',
      zh: '发布产品发布视频任务，提供品牌素材、验收窗口和商用说明。',
    },
    tags: ['Product launch', 'Short video', 'Brand kit', 'Social ads', 'Commercial rights'],
    zhTags: ['产品发布', '短视频', '品牌素材', '社媒广告', '商用授权'],
    categories: ['Video', 'Image'],
    languages: ['EN'],
    stats: { score: 912, completed: 3, posted: 42, response: '20m', acceptance: '95%', earned: '4K pts', paid: '$18K', rank: 'Top publisher' },
    badges: [
      { en: 'Clear briefs', zh: '需求清晰' },
      { en: 'Fast acceptance', zh: '验收迅速' },
    ],
    portfolio: [
      { en: '30-second launch video briefs with private brand files', zh: '30 秒发布视频需求与私密品牌素材' },
      { en: 'Commercial rights checklist for social campaigns', zh: '社媒投放商用授权清单' },
    ],
    reviews: [
      { en: 'Great publisher: clear scope and fast review.', zh: '很好的发布方：范围清楚，验收很快。' },
      { en: 'Assets were complete from day one.', zh: '第一天素材就很完整。' },
    ],
  },
  {
    id: 'coursecn',
    handle: 'coursecn',
    initials: 'CN',
    lane: 'publisher',
    name: { en: 'CourseCN', zh: '中文课程组' },
    role: { en: 'Chinese course campaign publisher', zh: '中文课程投放需求方' },
    bio: {
      en: 'Publishes Chinese course video, voiceover, captions, and review-ready delivery tasks.',
      zh: '发布中文课程短视频、配音、字幕和可验收交付任务。',
    },
    tags: ['Chinese course', 'Vertical video', 'Voiceover', 'Captions', 'Paid ads'],
    zhTags: ['中文课程', '竖版视频', '配音', '字幕', '投放广告'],
    categories: ['Video', 'Voice'],
    languages: ['中文'],
    stats: { score: 896, completed: 2, posted: 36, response: '24m', acceptance: '94%', earned: '3K pts', paid: '¥42K', rank: 'Top publisher' },
    badges: [
      { en: 'Chinese briefs', zh: '中文需求清晰' },
      { en: 'Milestone review', zh: '分阶段验收' },
    ],
    portfolio: [
      { en: 'Chinese course launch video task pack', zh: '中文课程宣传短视频任务包' },
      { en: 'Voiceover and caption acceptance checklist', zh: '配音与字幕验收清单' },
    ],
    reviews: [
      { en: 'The brief explains audience and tone clearly.', zh: '需求把用户和语气说得很清楚。' },
      { en: 'Good review rhythm: script first, final later.', zh: '验收节奏好：先看脚本，再看成片。' },
    ],
  },
  {
    id: 'opsplus',
    handle: 'opsplus',
    initials: 'OP',
    lane: 'publisher',
    name: { en: 'OpsPlus', zh: 'OpsPlus 企业运营' },
    role: { en: 'Enterprise AI workflow publisher', zh: '企业 AI 工作流需求方' },
    bio: {
      en: 'Posts knowledge-base, chatbot, permission, and human-review workflow requirements.',
      zh: '发布知识库、问答机器人、权限边界和人工复核流程需求。',
    },
    tags: ['Enterprise AI', 'Chatbot', 'Knowledge base', 'Permissions', 'Review workflow'],
    zhTags: ['企业 AI', '问答机器人', '知识库', '权限', '人工复核'],
    categories: ['Automation', 'Prompt'],
    languages: ['中文'],
    stats: { score: 841, completed: 1, posted: 28, response: '32m', acceptance: '90%', earned: '2K pts', paid: '¥33K', rank: 'Top 6%' },
    badges: [
      { en: 'Enterprise-ready', zh: '企业需求' },
      { en: 'Detailed docs', zh: '资料完整' },
    ],
    portfolio: [
      { en: 'Knowledge-base chatbot front-end requirement pack', zh: '企业知识库机器人前端需求包' },
      { en: 'Manual review fallback flow', zh: '人工复核兜底流程' },
    ],
    reviews: [
      { en: 'Complex, but very well documented.', zh: '需求复杂，但资料写得很完整。' },
      { en: 'Good for makers who like system thinking.', zh: '适合喜欢系统拆解的创作者。' },
    ],
  },
  {
    id: 'beautylab',
    handle: 'beautylab',
    initials: 'BL',
    lane: 'publisher',
    name: { en: 'Beauty Lab', zh: '美妆实验室' },
    role: { en: 'Beauty commerce publisher', zh: '美妆电商需求方' },
    bio: {
      en: 'Needs clean product images, Xiaohongshu-style prompts, and ad-ready visual testing packs.',
      zh: '需要干净高级的产品图、小红书提示词和广告投放测试视觉包。',
    },
    tags: ['Beauty product', 'Xiaohongshu', 'E-commerce image', 'Prompt pack', 'Ad testing'],
    zhTags: ['美妆产品', '小红书', '电商产品图', '提示词包', '广告测试'],
    categories: ['Image', 'Design', 'Prompt'],
    languages: ['中文'],
    stats: { score: 826, completed: 0, posted: 22, response: '27m', acceptance: '92%', earned: '1K pts', paid: '¥21K', rank: 'Top 8%' },
    badges: [
      { en: 'Visual reference ready', zh: '参考图齐备' },
      { en: 'Prompt buyer', zh: '提示词采购方' },
    ],
    portfolio: [
      { en: 'Beauty prompt pack for product covers and detail images', zh: '美妆封面图与详情图提示词包' },
      { en: 'Clean lighting requirements for ad tests', zh: '广告测试用干净布光要求' },
    ],
    reviews: [
      { en: 'Precise references and taste direction.', zh: '参考图和审美方向都很明确。' },
      { en: 'A good publisher for image prompt specialists.', zh: '很适合图片提示词创作者接单。' },
    ],
  },
  {
    id: 'taskops',
    handle: 'taskops',
    initials: 'TO',
    lane: 'both',
    name: { en: 'Task Ops', zh: '任务运营组' },
    role: { en: 'Marketplace operator and template curator', zh: '任务广场运营与模板整理者' },
    bio: {
      en: 'Curates task templates, community recaps, acceptance examples, and public profile proof.',
      zh: '整理任务模板、社区复盘、验收示例和公开主页能力证明。',
    },
    tags: ['Task templates', 'Community ops', 'Acceptance examples', 'Profile proof', 'Moderation'],
    zhTags: ['任务模板', '社区运营', '验收示例', '主页证明', '内容治理'],
    categories: ['Prompt', 'Automation', 'Video', 'Image'],
    languages: ['EN', '中文'],
    stats: { score: 954, completed: 14, posted: 31, response: '10m', acceptance: '96%', earned: '21K pts', paid: '¥16K', rank: 'Top operator' },
    badges: [
      { en: 'Template curator', zh: '模板精选' },
      { en: 'Marketplace guide', zh: '广场指引' },
    ],
    portfolio: [
      { en: 'Tutorial: split a vague request into an accepted task', zh: '教程：把模糊需求拆成可验收任务' },
      { en: 'Public profile proof model for makers', zh: '接单者公开主页证明模型' },
    ],
    reviews: [
      { en: 'Knows how to turn work into reusable community knowledge.', zh: '很会把任务沉淀成社区可复用知识。' },
      { en: 'Useful bridge between publishers and makers.', zh: '能很好连接发布方和接单者。' },
    ],
  },
  {
    id: 'clipcraft',
    handle: 'clipcraft',
    initials: 'CC',
    lane: 'maker',
    name: { en: 'ClipCraft Lab', zh: '短片工坊' },
    role: { en: 'Short-video editing and ad variant maker', zh: '短视频剪辑与广告变体创作者' },
    bio: {
      en: 'Produces fast launch clips, hook tests, caption variants, and mobile-first video packs.',
      zh: '制作发布短片、开头钩子测试、字幕变体和移动端优先的视频交付包。',
    },
    tags: ['Short video', 'Launch ads', 'Captions', 'Hook testing', 'Mobile exports'],
    zhTags: ['短视频', '发布广告', '字幕', '钩子测试', '移动端导出'],
    categories: ['Video', 'Image'],
    languages: ['EN', '中文'],
    stats: { score: 938, completed: 34, posted: 3, response: '11m', acceptance: '96%', earned: '25K pts', paid: '$7.8K', rank: 'Top 2%' },
    badges: [
      { en: 'Hook tester', zh: '钩子测试' },
      { en: 'Fast video packs', zh: '短片交付快' },
    ],
    portfolio: [
      { en: 'Six launch-video variations with captions and thumbnails', zh: '六版发布短片，含字幕和缩略图' },
      { en: 'Mobile-first hook test sheet for ads', zh: '面向移动端广告的开头钩子测试表' },
    ],
    reviews: [
      { en: 'Delivered clean variants before the first review window.', zh: '首轮验收前就交付了清晰的多版本。' },
      { en: 'Great rhythm for product-first videos.', zh: '产品优先的视频节奏很好。' },
    ],
  },
  {
    id: 'brandmuse',
    handle: 'brandmuse',
    initials: 'BM',
    lane: 'both',
    name: { en: 'Brand Muse', zh: '品牌灵感社' },
    role: { en: 'Brand visual publisher and prompt reviewer', zh: '品牌视觉需求方与提示词评审' },
    bio: {
      en: 'Publishes visual identity tasks, evaluates prompt packs, and keeps examples ready for makers.',
      zh: '发布品牌视觉任务，评审提示词包，并为创作者准备清晰参考样例。',
    },
    tags: ['Brand identity', 'Visual QA', 'Prompt review', 'Campaign assets', 'Style guide'],
    zhTags: ['品牌视觉', '视觉质检', '提示词评审', '活动素材', '风格指南'],
    categories: ['Image', 'Design', 'Prompt'],
    languages: ['EN', '中文'],
    stats: { score: 902, completed: 8, posted: 39, response: '19m', acceptance: '93%', earned: '6K pts', paid: '¥52K', rank: 'Top publisher' },
    badges: [
      { en: 'Reference rich', zh: '参考资料充分' },
      { en: 'Visual QA', zh: '视觉验收清晰' },
    ],
    portfolio: [
      { en: 'Brand-cover prompt audit with pass/fail samples', zh: '品牌封面提示词审核，含通过和失败样例' },
      { en: 'Campaign visual checklist for image makers', zh: '面向图片创作者的活动视觉检查表' },
    ],
    reviews: [
      { en: 'Taste direction is direct and easy to act on.', zh: '审美方向直接，创作者很好执行。' },
      { en: 'Review notes are strict but useful.', zh: '验收意见严格但有帮助。' },
    ],
  },
  {
    id: 'datahan',
    handle: 'datahan',
    initials: 'DH',
    lane: 'maker',
    name: { en: 'Data Han', zh: '韩 Data' },
    role: { en: 'AI chatbot flow and test-set builder', zh: 'AI 对话流程与测试集搭建者' },
    bio: {
      en: 'Turns docs into chatbot flows, permission cases, evaluation sets, and front-end demo scripts.',
      zh: '把文档整理成对话流程、权限场景、评测集和前端演示脚本。',
    },
    tags: ['Chatbot', 'Evaluation set', 'Knowledge base', 'Permissions', 'Automation'],
    zhTags: ['对话机器人', '评测集', '知识库', '权限', '自动化'],
    categories: ['Automation', 'Prompt'],
    languages: ['EN', '中文'],
    stats: { score: 918, completed: 29, posted: 6, response: '17m', acceptance: '95%', earned: '24K pts', paid: '¥31K', rank: 'Top 3%' },
    badges: [
      { en: 'Evaluation builder', zh: '评测集搭建' },
      { en: 'Enterprise flow', zh: '企业流程熟悉' },
    ],
    portfolio: [
      { en: '50-case chatbot evaluation set with permissions', zh: '50 条带权限边界的机器人评测集' },
      { en: 'Knowledge-base import and fallback flow prototype', zh: '知识库导入与兜底流程原型' },
    ],
    reviews: [
      { en: 'The edge-case list found real product gaps.', zh: '边界案例清单发现了真实产品漏洞。' },
      { en: 'Very good at making chatbot flows testable.', zh: '很擅长把对话流程变得可测试。' },
    ],
  },
  {
    id: 'scriptbear',
    handle: 'scriptbear',
    initials: 'SB',
    lane: 'maker',
    name: { en: 'Script Bear', zh: '脚本熊' },
    role: { en: 'Bilingual scriptwriter for video and chat demos', zh: '双语视频与对话演示脚本作者' },
    bio: {
      en: 'Writes bilingual scripts, scene beats, CTA variants, and concise demo conversations.',
      zh: '撰写双语脚本、分镜节奏、CTA 变体和简洁的演示对话。',
    },
    tags: ['Scriptwriting', 'Bilingual', 'CTA', 'Storyboard', 'Demo chat'],
    zhTags: ['脚本写作', '双语', '行动号召', '分镜', '对话演示'],
    categories: ['Video', 'Prompt'],
    languages: ['EN', '中文'],
    stats: { score: 872, completed: 21, posted: 4, response: '13m', acceptance: '94%', earned: '13K pts', paid: '¥14K', rank: 'Top 7%' },
    badges: [
      { en: 'Bilingual copy', zh: '双语文案' },
      { en: 'CTA variants', zh: '转化文案变体' },
    ],
    portfolio: [
      { en: 'Three CTA variants for a SaaS launch video', zh: 'SaaS 发布视频三套转化结尾' },
      { en: 'Chinese course ad script with hook tests', zh: '中文课程广告脚本与钩子测试' },
    ],
    reviews: [
      { en: 'The script was easy for the editor to execute.', zh: '脚本对剪辑师非常友好。' },
      { en: 'Good balance between selling and sounding human.', zh: '卖点表达和真实感平衡得好。' },
    ],
  },
  {
    id: 'modelnova',
    handle: 'modelnova',
    initials: 'MN',
    lane: 'maker',
    name: { en: 'Model Nova', zh: '模特 Nova' },
    role: { en: 'AI model image and fashion prompt maker', zh: 'AI 模特图与服饰提示词创作者' },
    bio: {
      en: 'Creates clean AI model images, apparel prompt systems, pose references, and retouch notes.',
      zh: '制作 AI 模特图、服饰提示词系统、姿势参考和修图说明。',
    },
    tags: ['AI model', 'Fashion', 'Pose reference', 'Retouch notes', 'E-commerce image'],
    zhTags: ['AI 模特', '服饰', '姿势参考', '修图说明', '电商图'],
    categories: ['Image', 'Design'],
    languages: ['中文'],
    stats: { score: 861, completed: 18, posted: 2, response: '21m', acceptance: '92%', earned: '12K pts', paid: '¥17K', rank: 'Top 8%' },
    badges: [
      { en: 'Fashion prompt', zh: '服饰提示词' },
      { en: 'Retouch aware', zh: '懂修图交付' },
    ],
    portfolio: [
      { en: 'Apparel AI model prompt pack for four scenes', zh: '四个场景的服饰 AI 模特提示词包' },
      { en: 'Pose reference and negative prompt checklist', zh: '姿势参考与负面提示词检查表' },
    ],
    reviews: [
      { en: 'Clear pose and lighting notes.', zh: '姿势和光线说明清楚。' },
      { en: 'Useful for avoiding awkward hands and fabric errors.', zh: '对避免手部和面料错误很有用。' },
    ],
  },
  {
    id: 'legalpixel',
    handle: 'legalpixel',
    initials: 'LP',
    lane: 'both',
    name: { en: 'Legal Pixel', zh: '版权像素' },
    role: { en: 'Rights checklist and delivery policy reviewer', zh: '版权清单与交付规范评审' },
    bio: {
      en: 'Reviews usage rights, attribution terms, delivery disclaimers, and marketplace acceptance wording.',
      zh: '评审使用权、署名条款、交付免责声明和任务验收措辞。',
    },
    tags: ['Usage rights', 'Attribution', 'Policy', 'Acceptance wording', 'Delivery notes'],
    zhTags: ['使用权', '署名', '规则', '验收措辞', '交付说明'],
    categories: ['Prompt', 'Automation'],
    languages: ['EN', '中文'],
    stats: { score: 834, completed: 16, posted: 11, response: '25m', acceptance: '97%', earned: '10K pts', paid: '¥12K', rank: 'Top 10%' },
    badges: [
      { en: 'Rights safe', zh: '版权清晰' },
      { en: 'Policy helper', zh: '规则助手' },
    ],
    portfolio: [
      { en: 'Usage-rights checklist for AI image and video tasks', zh: 'AI 图片和视频任务使用权检查表' },
      { en: 'Marketplace delivery disclaimer template', zh: '任务广场交付免责声明模板' },
    ],
    reviews: [
      { en: 'Caught ambiguous rights language before launch.', zh: '上线前发现了模糊的版权表述。' },
      { en: 'Short, clear, and practical policy notes.', zh: '规则说明短、清楚、实用。' },
    ],
  },
  {
    id: 'retailops',
    handle: 'retailops',
    initials: 'RO',
    lane: 'publisher',
    name: { en: 'Retail Ops', zh: '零售运营组' },
    role: { en: 'Retail campaign publisher', zh: '零售活动需求方' },
    bio: {
      en: 'Publishes e-commerce image, seasonal campaign, product copy, and storefront automation tasks.',
      zh: '发布电商图片、季节活动、商品文案和店铺自动化任务。',
    },
    tags: ['Retail campaign', 'Product copy', 'Storefront', 'E-commerce image', 'Seasonal ads'],
    zhTags: ['零售活动', '商品文案', '店铺', '电商图', '季节广告'],
    categories: ['Image', 'Prompt', 'Automation'],
    languages: ['EN', '中文'],
    stats: { score: 858, completed: 4, posted: 33, response: '29m', acceptance: '91%', earned: '2K pts', paid: '¥27K', rank: 'Top 9%' },
    badges: [
      { en: 'Frequent briefs', zh: '需求频繁' },
      { en: 'Retail assets', zh: '零售素材完整' },
    ],
    portfolio: [
      { en: 'Seasonal product image prompt request pack', zh: '季节商品图提示词需求包' },
      { en: 'Storefront copy generation acceptance notes', zh: '店铺文案生成验收说明' },
    ],
    reviews: [
      { en: 'Lots of assets and clear product constraints.', zh: '素材多，商品限制写得清楚。' },
      { en: 'Good for makers who like recurring work.', zh: '适合喜欢长期复购任务的创作者。' },
    ],
  },
  {
    id: 'edustack',
    handle: 'edustack',
    initials: 'ES',
    lane: 'publisher',
    name: { en: 'EduStack', zh: 'EduStack 教研组' },
    role: { en: 'Education product publisher', zh: '教育产品需求方' },
    bio: {
      en: 'Publishes lesson previews, AI tutors, course trailers, and education conversion experiments.',
      zh: '发布课程预告、AI 助教、课程宣传片和教育转化实验任务。',
    },
    tags: ['Education', 'AI tutor', 'Course trailer', 'Lesson preview', 'Conversion'],
    zhTags: ['教育', 'AI 助教', '课程宣传片', '课程预告', '转化'],
    categories: ['Video', 'Voice', 'Automation'],
    languages: ['EN', '中文'],
    stats: { score: 889, completed: 5, posted: 45, response: '23m', acceptance: '94%', earned: '5K pts', paid: '¥61K', rank: 'Top publisher' },
    badges: [
      { en: 'Education briefs', zh: '教育需求清楚' },
      { en: 'Repeat publisher', zh: '复购发布方' },
    ],
    portfolio: [
      { en: 'AI tutor front-end demo requirements', zh: 'AI 助教前端演示需求' },
      { en: 'Lesson preview video acceptance pack', zh: '课程预告视频验收包' },
    ],
    reviews: [
      { en: 'Great at defining student scenarios.', zh: '很会定义学生使用场景。' },
      { en: 'Review cycles are predictable.', zh: '验收周期稳定可预期。' },
    ],
  },
]

const tasks: Task[] = [
  {
    id: 1,
    title: 'Create a 30-second AI product launch video',
    category: 'Video',
    budget: '$450',
    points: '4,500 pts',
    status: 'Open',
    deadline: '3 days',
    proposals: 12,
    description: 'Need a polished vertical video with product shots, captions, music, and fast edits.',
    publisher: 'launchteam',
    assignee: 'Unassigned',
    requirements: [
      '9:16 vertical edit, 30 seconds, product-first opening in the first 3 seconds.',
      'AI music bed, burned captions, three hook variations, and editable project notes.',
      'Final delivery should include MP4, caption file, prompt recipe, and usage rights summary.',
    ],
    attachments: ['brand-kit.zip', 'product-stills-drive', 'launch-copy.md'],
    privateBrief: 'Priority audience is DTC founders. Avoid generic neon tech visuals.',
    submission: 'No submission yet. The assignee will upload preview links and export files here.',
    resultLinks: ['Waiting for assignee'],
    reviewNote: 'Publisher will approve after one revision round and mobile preview check.',
    rights: 'Commercial social usage, 12 months, creator credit optional.',
  },
  {
    id: 2,
    title: 'Generate 20 album-cover concepts for a lofi playlist',
    category: 'Image',
    budget: '$180',
    points: '1,800 pts',
    status: 'In Progress',
    deadline: '5 days',
    proposals: 8,
    description: 'Warm city-night visual system with reusable prompt recipes and cover variations.',
    publisher: 'musecurator',
    assignee: 'iriswood',
    requirements: [
      '20 square covers, consistent color mood, 5 prompt families with remix notes.',
      'Include seed/reference notes so the publisher can reproduce the strongest styles.',
      'Avoid visible text in the artwork and keep room for playlist typography.',
    ],
    attachments: ['moodboard.png', 'playlist-brief.pdf'],
    privateBrief: 'Publisher prefers rain, train windows, warm interior light, and no faces.',
    submission: 'First 8 covers submitted as a preview board. Waiting on full pack.',
    resultLinks: ['figma.com/lofi-board', 'drive/preview-pack-01'],
    reviewNote: 'Good style consistency. Need more negative space on four concepts.',
    rights: 'Commercial playlist and social use with creator attribution.',
  },
  {
    id: 3,
    title: 'Write prompts for an AI music pack',
    category: 'Prompt',
    budget: '$120',
    points: '1,200 pts',
    status: 'Pending Review',
    deadline: 'Tomorrow',
    proposals: 5,
    description: 'Need structured prompts across pop, house, cinematic, and game music moods.',
    publisher: 'soundforge',
    assignee: 'stillcole',
    requirements: [
      '40 prompts grouped by genre, BPM feeling, instrument palette, and vocal direction.',
      'Add negative prompts for avoiding muddy mixes and generic chorus phrasing.',
      'Include a short QA checklist for generated tracks.',
    ],
    attachments: ['genre-map.csv'],
    privateBrief: 'Client wants pack names that can be used in paid creator bundles.',
    submission: 'Submitted prompt library with QA checklist and two example generations.',
    resultLinks: ['notion.so/music-pack-prompts', 'drive/examples'],
    reviewNote: 'Awaiting publisher acceptance. Admin can release points after approval.',
    rights: 'Publisher can resell prompt pack; creator remains credited in contribution history.',
  },
  {
    id: 4,
    title: 'Voiceover cleanup and AI narrator matching',
    category: 'Voice',
    budget: '$320',
    points: '3,200 pts',
    status: 'Completed',
    deadline: 'Done',
    proposals: 14,
    description: 'Match existing narrator tone, clean breaths, and export three variants.',
    publisher: 'learnlab',
    assignee: 'n8than',
    requirements: [
      'Clean 12 minutes of narration and create three matching AI voice alternates.',
      'Deliver WAV, MP3, edit notes, and before/after comparison.',
      'Keep pacing natural for education content.',
    ],
    attachments: ['raw-voice.wav', 'style-reference.mp3'],
    privateBrief: 'Use the calm narrator version for the paid course, not the trailer cut.',
    submission: 'Final files delivered with A/B preview and editing log.',
    resultLinks: ['drive/final-voice-pack', 'loom/review-walkthrough'],
    reviewNote: 'Accepted. Points released and contribution history updated.',
    rights: 'Course usage, internal ads, and LMS distribution.',
  },
  {
    id: 5,
    title: 'Build a reusable prompt workflow for e-commerce image ads',
    category: 'Automation',
    budget: '$260',
    points: '2,600 pts',
    status: 'Rejected',
    deadline: '2 days',
    proposals: 6,
    description: 'Create a workflow that turns product photos into consistent AI ad variations.',
    publisher: 'shopstudio',
    assignee: 'veyn',
    requirements: [
      'Reusable prompt template, before/after examples, and naming convention.',
      'Five categories: cosmetics, apparel, tech accessories, home goods, and food.',
      'Submission must include revision notes and known failure cases.',
    ],
    attachments: ['sample-products.zip', 'brand-rules.pdf'],
    privateBrief: 'Do not use lifestyle scenes with unrealistic hands or unreadable packaging.',
    submission: 'Submitted workflow was too broad and missed product category examples.',
    resultLinks: ['drive/rejected-workflow'],
    reviewNote: 'Rejected with feedback. Creator can resubmit with five category examples.',
    rights: 'Rights release only after accepted resubmission.',
  },
  {
    id: 6,
    title: '制作一套中文 AI 课程宣传短视频',
    category: 'Video',
    budget: '¥2,800',
    points: '2,800 积分',
    status: 'Open',
    deadline: '4 天',
    proposals: 9,
    description: '需要 3 条中文竖版短视频，包含课程卖点、字幕、AI 配音和封面建议。',
    publisher: 'coursecn',
    assignee: 'Unassigned',
    requirements: [
      '每条 20-30 秒，9:16 竖屏，前三秒要有明确痛点钩子。',
      '提供中文脚本、AI 配音建议、字幕文件、封面提示词和最终 MP4。',
      '风格要专业克制，适合知识付费课程投放。',
    ],
    attachments: ['课程大纲.pdf', '品牌色板.png', '讲师照片.zip'],
    privateBrief: '目标用户是一线城市职场新人，避免夸张营销和低质模板感。',
    submission: '等待接单者提交首版脚本和视频预览。',
    resultLinks: ['等待提交'],
    reviewNote: '发布方会先审核脚本，再进入视频成片验收。',
    rights: '课程推广、信息流广告、社群转发可用，需保留交付记录。',
  },
  {
    id: 7,
    title: '生成小红书美妆产品图提示词包',
    category: 'Image',
    budget: '¥1,200',
    points: '1,200 积分',
    status: 'Open',
    deadline: '2 天',
    proposals: 7,
    description: '需要一套可复用的小红书美妆产品图提示词，覆盖口红、精华、面霜和套装礼盒。',
    publisher: 'beautylab',
    assignee: 'Unassigned',
    requirements: [
      '每个品类提供 6 条中文提示词和 2 条负面提示词。',
      '补充构图、光线、背景、道具和后期修图建议。',
      '输出适合封面图、详情图和广告投放图的三类方案。',
    ],
    attachments: ['产品参考图.zip', '品牌视觉规范.pdf'],
    privateBrief: '风格要高级、干净，避免廉价影楼感和过度磨皮。',
    submission: '等待接单者提交提示词表格和样图说明。',
    resultLinks: ['等待提交'],
    reviewNote: '验收时会检查提示词是否可复用、是否覆盖不同产品线。',
    rights: '品牌电商和社媒投放可用，提示词版权归发布方。',
  },
  {
    id: 8,
    title: '整理企业知识库 AI 问答机器人需求',
    category: 'Automation',
    budget: '¥3,600',
    points: '3,600 积分',
    status: 'In Progress',
    deadline: '6 天',
    proposals: 11,
    description: '把企业内部制度、产品手册和客服 FAQ 拆成 AI 问答机器人前端原型需求。',
    publisher: 'opsplus',
    assignee: 'you',
    requirements: [
      '整理用户角色、问答场景、权限边界和数据导入流程。',
      '输出知识库分层、对话测试样例、错误回答兜底策略。',
      '提供前端页面清单：对话、知识库、任务日志、人工复核。',
    ],
    attachments: ['制度样例.docx', '客服FAQ.xlsx', '产品手册.pdf'],
    privateBrief: '重点验证中文长文档问答，暂不接入真实后端。',
    submission: '已提交需求拆解大纲，等待补充 20 条中文对话测试样例。',
    resultLinks: ['notion/enterprise-ai-chatbot-brief'],
    reviewNote: '请补充异常问题和人工转接说明。',
    rights: '仅用于企业内部原型评审，不公开客户资料。',
  },
  {
    id: 9,
    title: '中文课程广告 AI 配音与字幕交付',
    category: 'Voice',
    budget: '¥900',
    points: '900 积分',
    status: 'Pending Review',
    deadline: '今天',
    proposals: 4,
    description: '为课程广告生成 3 版中文 AI 配音，并整理 SRT 字幕和语速说明。',
    publisher: 'coursecn',
    assignee: 'voicelee',
    requirements: [
      '三种语气：可信专业、轻松亲和、强转化。',
      '交付 WAV、MP3、SRT、口播文本和模型参数说明。',
      '标注每版适合投放的平台和首句钩子。',
    ],
    attachments: ['广告脚本.docx', '发音词表.txt'],
    privateBrief: '讲师姓名和课程名称要读准确，不能有机械断句。',
    submission: '已提交三版配音、字幕文件和语速对比说明。',
    resultLinks: ['drive/chinese-voiceover-pack', 'loom/voice-review'],
    reviewNote: '等待发布方试听验收，管理员可模拟通过。',
    rights: '课程广告和社群转发可用，不可用于其他品牌。',
  },
  {
    id: 10,
    title: '国风 Lo-fi 歌单开场音乐制作',
    category: 'Music',
    budget: '¥1,500',
    points: '1,500 积分',
    status: 'Completed',
    deadline: '已完成',
    proposals: 13,
    description: '制作 15 秒国风 Lo-fi 歌单片头，融合古筝采样、低保真鼓点和夜色城市氛围。',
    publisher: 'musiccn',
    assignee: 'yumi',
    requirements: [
      '15 秒循环无明显断点，适合短视频片头。',
      '交付 WAV、MP3、BPM、提示词、可复用风格说明。',
      '避免传统民乐堆叠，保持轻松现代。',
    ],
    attachments: ['歌单封面.png', '参考音乐链接.md'],
    privateBrief: '希望有“夜晚学习陪伴感”，不要太戏曲化。',
    submission: '最终音频、提示词和循环说明已交付。',
    resultLinks: ['drive/guofeng-lofi-intro', 'audio/loop-preview'],
    reviewNote: '验收通过，已进入贡献历史。',
    rights: '歌单、短视频和社区展示可用，需保留创作者署名。',
  },
  {
    id: 11,
    title: 'AI 任务二次提交说明模板优化',
    category: 'Prompt',
    budget: '¥600',
    points: '600 积分',
    status: 'Rejected',
    deadline: '1 天',
    proposals: 3,
    description: '整理被驳回后的二次提交说明模板，帮助创作者清楚回应修改意见。',
    publisher: 'taskops',
    assignee: 'promptlin',
    requirements: [
      '包含问题复述、修改内容、未改原因、验证方式、版本链接。',
      '提供中文短模板、详细模板和客服式语气模板。',
      '补充三个真实任务场景：图片、视频、自动化。',
    ],
    attachments: ['驳回示例.md'],
    privateBrief: '模板要礼貌但不冗长，适合直接复制到交付说明。',
    submission: '初稿缺少场景示例，只有通用句式。',
    resultLinks: ['docs/resubmission-template-v1'],
    reviewNote: '已驳回：请补充三个具体场景和验收对应关系。',
    rights: '平台模板可公开展示，署名保留。',
  },
  {
    id: 12,
    title: 'Design a customer-support chatbot demo script',
    category: 'Automation',
    budget: '$520',
    points: '5,200 pts',
    status: 'Open',
    deadline: '4 days',
    proposals: 15,
    description: 'Create a polished front-end demo plan for an AI support assistant with routing, FAQ answers, and human handoff.',
    publisher: 'edustack',
    assignee: 'Unassigned',
    requirements: [
      'Map user intents, fallback messages, escalation rules, and success metrics.',
      'Provide 20 test conversations across billing, onboarding, course access, and refunds.',
      'Deliver UI states for loading, answer confidence, human review, and feedback capture.',
    ],
    attachments: ['support-faq.csv', 'tone-guide.md', 'course-access-flow.png'],
    privateBrief: 'The demo should feel enterprise-ready, but still friendly for students and parents.',
    submission: 'No submission yet. Waiting for a maker to claim the chatbot workflow brief.',
    resultLinks: ['Waiting for assignee'],
    reviewNote: 'Publisher will review the conversation map before the UI flow is finalized.',
    rights: 'Internal sales demo and public case-study screenshots after approval.',
  },
  {
    id: 13,
    title: 'Create a fashion AI model image prompt pack',
    category: 'Image',
    budget: '$300',
    points: '3,000 pts',
    status: 'In Progress',
    deadline: '5 days',
    proposals: 10,
    description: 'Build reusable prompts for clean apparel model shots with consistent poses, lighting, and product visibility.',
    publisher: 'retailops',
    assignee: 'modelnova',
    requirements: [
      'Cover studio white background, outdoor city, lifestyle room, and close-up detail scenes.',
      'Include pose references, negative prompts, crop rules, and retouching notes.',
      'Avoid distorted hands, warped logos, and fabric patterns that hide the product.',
    ],
    attachments: ['apparel-samples.zip', 'pose-reference-board.pdf'],
    privateBrief: 'Prioritize mid-market fashion catalog quality over luxury editorial styling.',
    submission: 'Submitted first 12 prompts and 6 sample images. Waiting for feedback on pose consistency.',
    resultLinks: ['figma.com/fashion-model-board', 'drive/sample-renders'],
    reviewNote: 'Good lighting direction. Need stronger negative prompts for hands and collars.',
    rights: 'E-commerce catalog, ad tests, and internal prompt reuse.',
  },
  {
    id: 14,
    title: 'Audit usage-rights wording for AI video tasks',
    category: 'Prompt',
    budget: '$160',
    points: '1,600 pts',
    status: 'Pending Review',
    deadline: 'Tomorrow',
    proposals: 4,
    description: 'Review task templates and tighten the rights language for AI image, video, music, and voice deliverables.',
    publisher: 'taskops',
    assignee: 'legalpixel',
    requirements: [
      'Flag ambiguous wording around commercial use, attribution, resale, and derivative edits.',
      'Rewrite five acceptance clauses in plain marketplace language.',
      'Add a short creator-facing explanation for each rights clause.',
    ],
    attachments: ['rights-template-v1.md', 'example-briefs.zip'],
    privateBrief: 'Keep the language practical for front-end simulation. Avoid sounding like legal advice.',
    submission: 'Submitted a rights wording matrix and five rewritten acceptance clauses.',
    resultLinks: ['docs/rights-wording-v2', 'notion/rights-review-notes'],
    reviewNote: 'Awaiting admin review before adding the template to the inspiration library.',
    rights: 'Platform template reuse with attribution to the contributor.',
  },
  {
    id: 15,
    title: 'Write bilingual launch-video scripts for a SaaS feature',
    category: 'Video',
    budget: '$240',
    points: '2,400 pts',
    status: 'Completed',
    deadline: 'Done',
    proposals: 9,
    description: 'Create English and Chinese scripts for a 20-second SaaS feature launch with three CTA options.',
    publisher: 'launchteam',
    assignee: 'scriptbear',
    requirements: [
      'Deliver one English script, one Chinese script, and three CTA endings for each language.',
      'Add scene beats, on-screen caption text, and voiceover pacing notes.',
      'Keep the message product-specific and avoid generic AI hype.',
    ],
    attachments: ['feature-demo.mp4', 'positioning-notes.md'],
    privateBrief: 'The feature is workflow routing. Mention saved review time, not replacement of people.',
    submission: 'Final scripts, scene beats, and CTA variants delivered with editor notes.',
    resultLinks: ['docs/saas-launch-script-pack', 'drive/script-readthrough'],
    reviewNote: 'Accepted. The bilingual CTA variants were added to the campaign library.',
    rights: 'Campaign, website, and social usage. Creator credited in contribution history.',
  },
  {
    id: 16,
    title: 'Build prompt recipes for branded cover thumbnails',
    category: 'Design',
    budget: '$210',
    points: '2,100 pts',
    status: 'Rejected',
    deadline: '2 days',
    proposals: 5,
    description: 'Create thumbnail prompt recipes for podcast, course, and YouTube cover systems using a shared brand guide.',
    publisher: 'brandmuse',
    assignee: 'iriswood',
    requirements: [
      'Provide 15 prompt recipes across editorial, product, and tutorial cover styles.',
      'Include typography-safe layout notes and negative prompts for fake text.',
      'Add before/after examples and a naming convention for reusable prompt packs.',
    ],
    attachments: ['brand-guide.pdf', 'thumbnail-examples.zip'],
    privateBrief: 'The publisher wants brand consistency more than flashy individual concepts.',
    submission: 'Submitted prompts were strong visually but missed typography-safe layout notes.',
    resultLinks: ['drive/thumbnail-pack-v1'],
    reviewNote: 'Rejected with feedback: add safe title areas, crop rules, and fake-text prevention.',
    rights: 'Rights release after accepted resubmission.',
  },
  {
    id: 17,
    title: '搭建 AI 助教对话流程测试集',
    category: 'Automation',
    budget: '¥4,200',
    points: '4,200 积分',
    status: 'Open',
    deadline: '5 天',
    proposals: 14,
    description: '为在线课程 AI 助教整理对话流程和测试集，覆盖学习计划、作业反馈、课程退款和人工转接。',
    publisher: 'edustack',
    assignee: 'Unassigned',
    requirements: [
      '输出 50 条中文对话测试样例，包含正常问题、追问、越权问题和情绪化表达。',
      '整理意图分类、回答边界、人工转接触发条件和失败兜底话术。',
      '给出前端演示状态：思考中、引用资料、低置信度、已转人工、用户评价。',
    ],
    attachments: ['课程FAQ.xlsx', '助教功能草图.png', '人工客服规则.md'],
    privateBrief: '重点验证中文语境，不需要真实模型接入，但要让前端演示流程完整。',
    submission: '等待接单者提交测试集结构和前 10 条样例。',
    resultLinks: ['等待提交'],
    reviewNote: '发布方会先审核测试集结构，再验收完整样例。',
    rights: '仅用于教育产品原型和内部演示，不公开学员信息。',
  },
  {
    id: 18,
    title: '小红书服饰 AI 模特图改稿包',
    category: 'Image',
    budget: '¥1,800',
    points: '1,800 积分',
    status: 'In Progress',
    deadline: '3 天',
    proposals: 8,
    description: '需要优化一批服饰 AI 模特图提示词，解决手部、衣领、面料纹理和背景过乱的问题。',
    publisher: 'retailops',
    assignee: 'modelnova',
    requirements: [
      '按连衣裙、外套、通勤套装、运动服四类整理提示词和负面提示词。',
      '每类提供姿势、镜头、光线、背景和后期修图建议。',
      '输出可复制的改稿说明，方便发布方对照验收。',
    ],
    attachments: ['失败样图.zip', '服饰素材参考.pdf'],
    privateBrief: '风格要像真实电商图，不要过度网红感或杂志大片感。',
    submission: '已提交第一版改稿提示词和 8 张样图，等待发布方标注意见。',
    resultLinks: ['figma/ai-model-revision-board'],
    reviewNote: '请继续补充外套类的面料细节和手部负面提示。',
    rights: '电商商品页、社媒种草和内部提示词库可用。',
  },
  {
    id: 19,
    title: '中文发布会短片脚本和分镜',
    category: 'Video',
    budget: '¥2,400',
    points: '2,400 积分',
    status: 'Pending Review',
    deadline: '明天',
    proposals: 6,
    description: '为一款 AI 协作工具写 45 秒中文发布会短片脚本，包含分镜、字幕和转化结尾。',
    publisher: 'brandmuse',
    assignee: 'scriptbear',
    requirements: [
      '脚本要覆盖痛点、核心功能、协作场景和行动号召。',
      '输出旁白、屏幕字幕、镜头说明和三版结尾 CTA。',
      '附上剪辑师可执行的素材清单和节奏建议。',
    ],
    attachments: ['产品介绍.pdf', '品牌语气指南.md', '界面截图.zip'],
    privateBrief: '不要夸大 AI 能力，重点强调团队协作和交付记录。',
    submission: '已提交脚本、分镜表和三版 CTA，等待发布方确认语气。',
    resultLinks: ['docs/chinese-launch-script', 'figma/storyboard-board'],
    reviewNote: '待验收：语气基本合适，需要确认第三版 CTA 是否太强。',
    rights: '发布会、官网和社媒剪辑可用，保留脚本作者署名。',
  },
  {
    id: 20,
    title: '整理 AI 图片任务验收失败案例库',
    category: 'Prompt',
    budget: '¥980',
    points: '980 积分',
    status: 'Completed',
    deadline: '已完成',
    proposals: 12,
    description: '把图片任务中常见的失败原因整理成案例库，帮助发布方写清验收标准。',
    publisher: 'taskops',
    assignee: 'legalpixel',
    requirements: [
      '覆盖假文字、手部错误、品牌不一致、构图拥挤、版权范围不清五类问题。',
      '每类提供失败描述、修改建议、验收句式和可复用检查项。',
      '输出中英文双语版本，方便任务广场和社区引用。',
    ],
    attachments: ['失败案例截图.zip', '验收标准草稿.md'],
    privateBrief: '案例可以公开，但不要包含真实客户名称。',
    submission: '已交付双语案例库、检查项和社区发布版摘要。',
    resultLinks: ['docs/image-task-failure-library', 'community/acceptance-examples'],
    reviewNote: '验收通过，已收入灵感库并推荐到社区。',
    rights: '平台公开模板可用，需保留贡献者署名。',
  },
  {
    id: 21,
    title: '音乐生成工具新手引导文案',
    category: 'Music',
    budget: '¥700',
    points: '700 积分',
    status: 'Open',
    deadline: '2 天',
    proposals: 5,
    description: '为音乐生成模块写中文新手引导文案，帮助用户理解风格、歌词、负面提示和版权说明。',
    publisher: 'musiccn',
    assignee: 'Unassigned',
    requirements: [
      '整理 8 个常见音乐生成场景：课程片头、广告 BGM、播客、游戏、Lo-fi、儿歌、国风、品牌音效。',
      '每个场景提供示例提示词、常见错误和交付检查点。',
      '补充简洁版权说明，不要造成真实授权误解。',
    ],
    attachments: ['现有引导截图.png', '生成示例音频.zip'],
    privateBrief: '文案要像产品内提示，不要写成教程长文。',
    submission: '等待接单者提交第一版引导文案。',
    resultLinks: ['等待提交'],
    reviewNote: '发布方会重点检查是否适合放在前端界面里。',
    rights: '平台产品内使用，贡献者可展示为作品案例。',
  },
]

const posts: Post[] = [
  {
    id: 1,
    title: 'Prompt stack for better chorus hooks',
    category: 'Prompts',
    author: 'stillcole',
    replies: 28,
    likes: '1.2K',
    views: '18K',
    votes: 184,
    tag: 'Featured',
    solved: true,
    excerpt: 'A reusable chain for turning rough moods into singable sections and title ideas.',
  },
  {
    id: 2,
    title: 'Showcase: image-to-video lyric loop',
    category: 'Showcase',
    author: 'yumi',
    replies: 41,
    likes: '2.4K',
    views: '31K',
    votes: 256,
    tag: 'Hot',
    solved: false,
    excerpt: 'Made a loop from one cover image, then synced it to a generated city-pop track.',
  },
  {
    id: 3,
    title: 'How do you price AI task delivery?',
    category: 'Questions',
    author: 'n8than',
    replies: 16,
    likes: '684',
    views: '9.8K',
    votes: 71,
    tag: 'Discuss',
    solved: false,
    excerpt: 'Looking for advice on milestones, revision limits, and usage rights.',
  },
  {
    id: 4,
    title: 'Task recap: accepted voice cleanup delivery checklist',
    category: 'Task Recap',
    author: 'learnlab',
    replies: 12,
    likes: '528',
    views: '6.2K',
    votes: 49,
    tag: 'Solved',
    solved: true,
    excerpt: 'A public recap showing how the accepted voiceover task was scoped, reviewed, and archived.',
  },
  {
    id: 5,
    title: '中文任务复盘：AI 课程短视频如何写验收标准？',
    category: 'Task Recap',
    author: 'coursecn',
    replies: 19,
    likes: '806',
    views: '7.4K',
    votes: 88,
    tag: '中文',
    solved: false,
    excerpt: '讨论中文短视频任务的脚本、字幕、配音、封面和投放版权如何写进需求。',
  },
  {
    id: 6,
    title: '中文提问：任务被驳回后怎么写二次提交说明？',
    category: 'Questions',
    author: 'promptlin',
    replies: 0,
    likes: '42',
    views: '680',
    votes: 18,
    tag: '未回复',
    solved: false,
    excerpt: '想要一个能对应修改意见、版本链接和验收标准的中文二次提交模板。',
  },
  {
    id: 7,
    title: '教程：用 AI 对话把模糊需求拆成可验收任务',
    category: 'Tutorials',
    author: 'taskops',
    replies: 24,
    likes: '1.1K',
    views: '12K',
    votes: 132,
    tag: '教程',
    solved: true,
    excerpt: '从一句“帮我做个宣传片”拆到预算、交付物、验收标准、版权和复审节点。',
  },
  {
    id: 8,
    title: '作品展示：国风 Lo-fi 歌单片头的提示词和循环处理',
    category: 'Showcase',
    author: 'musiccn',
    replies: 17,
    likes: '934',
    views: '8.6K',
    votes: 96,
    tag: '作品展示',
    solved: false,
    excerpt: '分享古筝采样、Lo-fi 鼓点和短视频片头循环的制作流程，欢迎协作改进。',
  },
  {
    id: 9,
    title: '协作招募：一起整理企业知识库 AI 问答测试集',
    category: 'Collaboration',
    author: 'opsplus',
    replies: 6,
    likes: '215',
    views: '2.2K',
    votes: 54,
    tag: '协作',
    solved: false,
    excerpt: '需要中文长文档问答、权限边界、人工复核和异常兜底的测试样例协作。',
  },
  {
    id: 10,
    title: 'Checklist: what belongs in a video-task private brief?',
    category: 'Task Recap',
    author: 'clipcraft',
    replies: 22,
    likes: '1.4K',
    views: '16K',
    votes: 171,
    tag: 'Featured',
    solved: true,
    excerpt: 'A practical split between public scope, private brand constraints, review windows, and usage rights.',
    body: 'The public brief should explain deliverables, category, budget, and deadline. The private brief should hold brand restrictions, audience details, sensitive assets, and approval rules. I also add a review calendar so creators know when feedback will land.',
  },
  {
    id: 11,
    title: 'Showcase: chatbot handoff states for an education AI tutor',
    category: 'Showcase',
    author: 'datahan',
    replies: 18,
    likes: '936',
    views: '8.9K',
    votes: 118,
    tag: 'Demo',
    solved: false,
    excerpt: 'Four front-end states for low confidence, source citation, human handoff, and student feedback.',
    body: 'The demo uses simulated data only, but the flow is complete enough to test product conversations. Each state has copy, acceptance notes, and a reason why the assistant should or should not answer.',
  },
  {
    id: 12,
    title: 'Question: should a prompt pack include failed examples?',
    category: 'Questions',
    author: 'brandmuse',
    replies: 11,
    likes: '402',
    views: '4.5K',
    votes: 67,
    tag: 'Discuss',
    solved: false,
    excerpt: 'I want to ask makers for failed image examples, but I do not want the brief to feel punitive.',
    body: 'Failed examples make review much easier when they are framed as learning notes. I am considering a template with cause, fix, negative prompt, and acceptance boundary.',
  },
  {
    id: 13,
    title: 'Tutorial: turning rights language into plain task acceptance rules',
    category: 'Tutorials',
    author: 'legalpixel',
    replies: 30,
    likes: '1.8K',
    views: '21K',
    votes: 205,
    tag: 'Featured',
    solved: true,
    excerpt: 'A plain-language framework for commercial use, attribution, resale, derivatives, and template reuse.',
    body: 'Do not bury rights language in a final note. Put the allowed channels, duration, attribution rule, and resale boundary directly in the acceptance section. Creators can then decide whether the reward matches the usage scope.',
  },
  {
    id: 14,
    title: 'Collaboration: build a public library of AI image failure cases',
    category: 'Collaboration',
    author: 'taskops',
    replies: 37,
    likes: '2.1K',
    views: '24K',
    votes: 230,
    tag: 'Hot',
    solved: false,
    excerpt: 'Looking for makers to contribute anonymized examples around hands, fake text, crop issues, and brand mismatch.',
    body: 'The goal is to make failure cases useful instead of embarrassing. Each entry should include the original requirement, what went wrong, how to revise it, and a better acceptance sentence.',
  },
  {
    id: 15,
    title: '中文教程：发布 AI 助教任务前要准备哪些资料？',
    category: 'Tutorials',
    author: 'datahan',
    replies: 26,
    likes: '1.3K',
    views: '13K',
    votes: 156,
    tag: '教程',
    solved: true,
    excerpt: '把课程 FAQ、角色权限、人工转接规则和失败兜底话术整理成发布需求前的检查清单。',
    body: '建议先准备课程大纲、常见问题、敏感问题边界、学员角色、人工转接规则和评价方式。这样接单者可以直接设计对话测试集，而不是反复追问基础信息。',
  },
  {
    id: 16,
    title: '中文提问：AI 模特图怎么写“不要网红感”的验收标准？',
    category: 'Questions',
    author: 'retailops',
    replies: 9,
    likes: '328',
    views: '3.6K',
    votes: 73,
    tag: '提问',
    solved: false,
    excerpt: '我们想要真实电商图，不想要过度精修、姿势夸张或背景太花的模特图。',
    body: '现在的表述太主观，只写了“真实自然”。想请社区帮忙改成能验收的规则，比如光线、姿势、背景、面料细节和修图强度。',
  },
  {
    id: 17,
    title: '中文复盘：被驳回后如何补交视频任务修改记录',
    category: 'Task Recap',
    author: 'scriptbear',
    replies: 14,
    likes: '687',
    views: '5.9K',
    votes: 91,
    tag: '复盘',
    solved: true,
    excerpt: '用一个发布会短片脚本案例说明如何回应语气、CTA、分镜和字幕四类修改意见。',
    body: '二次提交最好按照“反馈项-修改动作-验证方式-版本链接”排列。不要只写“已修改”，要说明为什么这样改，以及发布方应该检查哪里。',
  },
  {
    id: 18,
    title: '作品展示：课程广告三版中文配音对比',
    category: 'Showcase',
    author: 'voicelee',
    replies: 21,
    likes: '958',
    views: '9.1K',
    votes: 119,
    tag: '作品',
    solved: false,
    excerpt: '可信专业、轻松亲和、强转化三种语气在同一条课程广告里的差异。',
    body: '三版配音的差异不只在语速，还包括停顿位置、重音选择和首句钩子的情绪强度。帖子里附了模拟的 SRT 片段和验收说明。',
  },
  {
    id: 19,
    title: '中文协作：整理音乐生成新手引导场景',
    category: 'Collaboration',
    author: 'musiccn',
    replies: 7,
    likes: '246',
    views: '2.8K',
    votes: 52,
    tag: '协作',
    solved: false,
    excerpt: '想一起整理课程片头、广告 BGM、播客、游戏和国风 Lo-fi 的示例提示词。',
    body: '希望每个场景都有一句短提示、一个常见错误和一个版权提醒。这样可以直接放进生成工具的空状态或快捷提示里。',
  },
  {
    id: 20,
    title: 'How to present matched makers after publishing a task?',
    category: 'Questions',
    author: 'launchteam',
    replies: 13,
    likes: '533',
    views: '6.4K',
    votes: 82,
    tag: 'Discuss',
    solved: false,
    excerpt: 'Should the publisher see maker matches by score, tags, prior work, response time, or availability first?',
    body: 'I care most about confidence and examples, but the current mock shows all signals at once. I am collecting ideas for a cleaner matching explanation after the publish flow.',
  },
  {
    id: 21,
    title: 'Showcase: branded thumbnail prompt matrix',
    category: 'Showcase',
    author: 'iriswood',
    replies: 33,
    likes: '1.9K',
    views: '19K',
    votes: 198,
    tag: 'Featured',
    solved: true,
    excerpt: 'A matrix for editorial, product, and tutorial thumbnails with safe title areas and negative prompts.',
    body: 'The strongest improvement was separating composition from style. Every prompt includes a safe title area, crop rule, lighting note, and fake-text prevention clause.',
  },
  {
    id: 22,
    title: 'Question: how much should a reusable automation prompt workflow cost?',
    category: 'Questions',
    author: 'n8than',
    replies: 8,
    likes: '291',
    views: '3.1K',
    votes: 44,
    tag: 'Unanswered',
    solved: false,
    excerpt: 'The task is not just prompts. It includes examples, QA rules, naming conventions, and failure-case notes.',
    body: 'I usually price reusable workflows higher than one-off prompts because they become internal systems. Curious how others separate template value from production output.',
  },
  {
    id: 23,
    title: '中文提问：社区帖子转任务时要保留哪些上下文？',
    category: 'Questions',
    author: 'promptlin',
    replies: 3,
    likes: '119',
    views: '1.4K',
    votes: 31,
    tag: '未解决',
    solved: false,
    excerpt: '如果从讨论帖转成需求，哪些回复、附件、验收建议应该自动进入任务草稿？',
    body: '我倾向于保留原帖摘要、被点赞最多的建议、明确的交付物和争议点。否则发布方还要重新整理一次。',
  },
]

const myTaskStages = [
  {
    label: 'Claimed',
    value: '3',
    text: 'Active briefs that need first previews or clarification.',
  },
  {
    label: 'Submitted',
    value: '2',
    text: 'Deliverables waiting for publisher or admin review.',
  },
  {
    label: 'Completed',
    value: '14',
    text: 'Accepted work stored in your contribution history.',
  },
]

const engineMatches = [
  ['Video launch editor', '96%', 'Fast captioned product videos, music sync, social exports'],
  ['Prompt systems maker', '88%', 'Reusable prompt packs, QA checklists, task templates'],
  ['Voice cleanup specialist', '84%', 'Narration cleanup, AI matching, before/after proof'],
]

const inspirationItems: InspirationItem[] = [
  {
    title: 'Launch video acceptance checklist',
    type: 'Task template',
    source: 'AI Task Plaza',
    saves: '2.1K',
    text: 'Hook timing, deliverable list, review rules, and social video export standards.',
  },
  {
    title: 'Lofi cover prompt families',
    type: 'Prompt pack',
    source: 'Community featured',
    saves: '1.6K',
    text: 'Five reusable visual prompt systems with seed notes and negative prompt patterns.',
  },
  {
    title: 'Pricing AI delivery without chaos',
    type: 'Guide',
    source: 'Forum answer',
    saves: '928',
    text: 'Milestones, revision caps, usage rights, and points release examples.',
  },
  {
    title: '中文短视频任务验收模板',
    type: '中文模板',
    source: '社区复盘',
    saves: '418',
    text: '脚本钩子、字幕、AI 配音、封面、版权和复审节点的中文任务模板。',
  },
  {
    title: 'AI 任务二次提交说明模板',
    type: '中文模板',
    source: '社区问答',
    saves: '286',
    text: '包含问题复述、修改项、未改原因、验证方式、版本链接和再次验收请求。',
  },
  {
    title: '小红书封面提示词包',
    type: 'Prompt pack',
    source: '任务广场',
    saves: '742',
    text: '美妆、课程、知识付费、工具类封面提示词，覆盖构图、色彩、道具和负面提示。',
  },
  {
    title: 'AI 配音交付清单',
    type: 'Guide',
    source: '中文教程',
    saves: '391',
    text: 'WAV、MP3、SRT、口播文本、语速说明、发音词表和版权范围的交付检查表。',
  },
  {
    title: '课程投放案例复盘',
    type: 'Case study',
    source: '创作者社区',
    saves: '529',
    text: '从课程短视频脚本、AI 配音、封面提示词到信息流投放版本的完整复盘。',
  },
  {
    title: 'Chatbot handoff state checklist',
    type: 'Automation template',
    source: 'Community demo',
    saves: '812',
    text: 'Low-confidence answers, source citations, human handoff, feedback capture, and review-log states for AI support demos.',
  },
  {
    title: 'Rights wording matrix',
    type: 'Policy helper',
    source: 'Task Ops',
    saves: '674',
    text: 'Plain task language for commercial use, attribution, derivatives, resale boundaries, and platform template reuse.',
  },
  {
    title: 'Fashion AI model negative prompts',
    type: 'Prompt pack',
    source: 'Marketplace delivery',
    saves: '1.1K',
    text: 'Hands, collars, fabric texture, logo distortion, pose stiffness, and background clutter prevention for apparel images.',
  },
  {
    title: 'Bilingual CTA script endings',
    type: 'Script pack',
    source: 'Completed task',
    saves: '438',
    text: 'English and Chinese closing lines for SaaS launch videos, with soft, direct, and conversion-focused variants.',
  },
  {
    title: 'AI 助教测试集模板',
    type: '中文模板',
    source: '任务广场',
    saves: '623',
    text: '学习计划、作业反馈、退款咨询、越权问题、人工转接和用户评价的中文对话测试集结构。',
  },
  {
    title: 'AI 模特图验收失败案例',
    type: '中文案例库',
    source: '社区协作',
    saves: '917',
    text: '手部错误、衣领变形、面料纹理丢失、背景过乱和过度精修的验收句式与改稿建议。',
  },
  {
    title: '中文发布会短片分镜表',
    type: 'Video template',
    source: '待验收任务',
    saves: '356',
    text: '痛点开场、功能演示、团队协作场景、字幕节奏、素材清单和三版 CTA 的分镜模板。',
  },
  {
    title: '音乐生成新手引导场景库',
    type: '中文指南',
    source: '音乐创作模块',
    saves: '482',
    text: '课程片头、广告 BGM、播客、游戏、Lo-fi、儿歌、国风和品牌音效的短提示与常见错误。',
  },
]

const pointsLedger: LedgerEntry[] = [
  ['刚刚', '中文任务发布奖励：课程短视频需求', '+20', '18,440'],
  ['刚刚', '已接取任务：企业知识库 AI 问答机器人需求', '+50', '18,420'],
  ['今天 16:08', '已提交成果：中文课程广告 AI 配音与字幕交付', '+120', '18,370'],
  ['今天 15:42', '验收通过：国风 Lo-fi 歌单开场音乐制作', '+1,500', '18,250'],
  ['今天 15:10', '兑换任务曝光券', '-200', '16,750'],
  ['Today 14:20', 'Task accepted: voice cleanup delivery', '+3,200', '18,420'],
  ['Today 09:12', 'Community answer marked solved', '+120', '15,220'],
  ['Yesterday', 'Submitted music prompt pack for review', '+300', '15,100'],
  ['Jun 18', 'Published inspiration library template', '+80', '14,800'],
  ['Jun 17', 'Boosted task listing', '-200', '14,720'],
  ['刚刚', '社区回复奖励：AI 模特图验收标准建议', '+15', '18,455'],
  ['今天 17:22', '帖子入库：AI 助教测试集模板', '+10', '18,445'],
  ['今天 17:05', '任务被收藏：中文发布会短片脚本和分镜', '+35', '18,435'],
  ['今天 16:44', '完成验收：AI 图片任务验收失败案例库', '+980', '18,335'],
  ['今天 16:10', '发布协作帖：音乐生成新手引导场景库', '+30', '17,355'],
  ['Today 15:30', 'Matched maker accepted: chatbot demo script', '+50', '17,325'],
  ['Today 13:40', 'Saved rights wording matrix to library', '+10', '17,275'],
  ['Yesterday', 'Task rejected: branded cover thumbnail recipes', '+0', '17,265'],
  ['Jun 19', 'Featured community tutorial: rights language', '+180', '17,265'],
  ['Jun 18', 'Redeemed profile highlight for maker ranking', '-300', '17,085'],
]

const adminQueues = [
  ['Pending review', 'Music prompt pack', 'soundforge', 'Release 1,200 pts after acceptance'],
  ['Resubmission', 'E-commerce image ad workflow', 'shopstudio', 'Rejected once, needs category samples'],
  ['Community report', 'Pricing AI task delivery thread', 'n8than', 'Potentially feature to library'],
  ['Publish audit', 'Product launch video brief', 'launchteam', 'Check private attachment permissions'],
  ['Pending review', 'Usage-rights wording audit', 'taskops', 'Confirm clauses before public template reuse'],
  ['Resubmission', 'Branded cover thumbnail prompt recipes', 'brandmuse', 'Needs safe title areas and crop rules'],
  ['Community report', 'AI image failure-case library', 'taskops', 'Verify anonymized examples before featuring'],
  ['Publish audit', 'AI tutor test-set request', 'edustack', 'Check student data and privacy wording'],
  ['Submission check', 'Chinese launch-video storyboard', 'brandmuse', 'Review CTA tone and scene beats'],
  ['Profile review', 'Model Nova portfolio update', 'modelnova', 'Approve new fashion prompt proof cards'],
]

const planCards = [
  { name: 'Free', price: '$0', credits: '500 credits', songs: '10 songs/mo', badge: '' },
  { name: 'Plus', price: '$9.99', credits: '60K credits/year', songs: '100 songs/mo', badge: '' },
  { name: 'Pro', price: '$16.99', credits: '300K credits/year', songs: '500 songs/mo', badge: 'Most popular' },
  { name: 'Ultra', price: '$32.99', credits: 'Unlimited', songs: 'Unlimited generation', badge: '' },
]

const apiFeatures = [
  'Music AI',
  'Image Generation',
  'Text to Video',
  'Voice Generator',
  'Text to Speech',
  'AI Covers',
  'Stem Splitter',
  'Lyrics Generation',
  'BPM Detection',
]

function App() {
  const [locale, setLocale] = useState<Locale>('en')
  const [page, setPage] = useState<Page>('home')
  const [activeTrack, setActiveTrack] = useState<Track>(tracks[0])
  const [playing, setPlaying] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [billing, setBilling] = useState<'year' | 'month'>('year')
  const [prompt, setPrompt] = useState('Lo-fi instrumental song for late-night coding')
  const [generationState, setGenerationState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [taskList, setTaskList] = useState<Task[]>(tasks)
  const [postList, setPostList] = useState<Post[]>(posts)
  const [libraryItems, setLibraryItems] = useState<InspirationItem[]>(inspirationItems)
  const [ledgerItems, setLedgerItems] = useState<LedgerEntry[]>(pointsLedger)
  const [selectedTask, setSelectedTask] = useState<Task>(() => localeFirstTask(tasks, copy.en))
  const [selectedPost, setSelectedPost] = useState<Post>(() => localeFirstPost(posts, copy.en))
  const [selectedProfile, setSelectedProfile] = useState<MarketplaceProfile>(() => findProfile('taskops') ?? marketplaceProfiles[0])
  const [selectedSearchFilter, setSelectedSearchFilter] = useState('All')
  const [communityFilter, setCommunityFilter] = useState('Hot')
  const t = copy[locale]

  const navItems = [
    { key: 'home' as Page, label: t.home, icon: LayoutDashboard },
    { key: 'tasks' as Page, label: t.tasks, icon: BriefcaseBusiness },
    { key: 'mine' as Page, label: t.mine, icon: FileText },
    { key: 'community' as Page, label: t.community, icon: MessageCircle },
    { key: 'engine' as Page, label: t.engine, icon: Bot },
    { key: 'inspiration' as Page, label: t.inspiration, icon: Tags },
    { key: 'points' as Page, label: t.points, icon: Trophy },
    { key: 'explore' as Page, label: t.explore, icon: CompassIcon },
    { key: 'create' as Page, label: t.create, icon: WandSparkles },
    { key: 'chat' as Page, label: t.chat, icon: Bot },
    { key: 'image' as Page, label: t.image, icon: Image },
    { key: 'video' as Page, label: t.video, icon: Video },
    { key: 'admin' as Page, label: t.admin, icon: UsersRound },
  ]

  const footerItems = [
    { key: 'pricing' as Page, label: t.pricing },
    { key: 'earn' as Page, label: t.earn },
    { key: 'api' as Page, label: t.api },
    { key: 'about' as Page, label: t.about },
    { key: 'terms' as Page, label: t.terms },
    { key: 'privacy' as Page, label: t.privacy },
  ]

  const runGenerate = () => {
    setGenerationState('loading')
    window.setTimeout(() => setGenerationState('done'), 900)
  }

  const playTrack = (track: Track) => {
    setActiveTrack(track)
    setPlaying(true)
  }

  const requireAuth = () => setLoginOpen(true)

  const pushToast = (message: string) => {
    console.info('[simulation]', message)
  }

  const pushLedger = (description: string, delta: string) => {
    setLedgerItems((current) => [[locale === 'zh' ? '刚刚' : 'Just now', description, delta, locale === 'zh' ? '实时' : 'Live'], ...current])
  }

  const openProfile = (profile: MarketplaceProfile) => {
    setSelectedProfile(profile)
    setPage('profile')
    pushToast(locale === 'zh' ? `已打开用户主页：@${profile.handle}` : `Opened public profile: @${profile.handle}`)
  }

  const simulateAction: SimulateAction = (message, ledger) => {
    pushToast(message)
    if (ledger) {
      pushLedger(ledger.description, ledger.delta)
    }
  }

  const bumpLikeCount = (value: string) => {
    if (value.includes('K')) {
      const numeric = Number.parseFloat(value)
      return Number.isFinite(numeric) ? `${(numeric + 0.1).toFixed(1)}K` : value
    }
    const numeric = Number.parseInt(value, 10)
    return Number.isFinite(numeric) ? `${numeric + 1}` : value
  }

  const publishTask = (draft: PublishDraft) => {
    const isZh = locale === 'zh'
    const newTask: Task = {
      id: Date.now(),
      title: draft.title || (isZh ? '未命名 AI 任务' : 'Untitled AI task'),
      category: draft.category || 'Video',
      budget: draft.reward.split('/')[0]?.trim() || draft.reward || (isZh ? '¥800' : '$120'),
      points: draft.reward.split('/')[1]?.trim() || (isZh ? '800 积分' : '800 pts'),
      status: 'Open',
      deadline: draft.deadline || (isZh ? '3 天' : '3 days'),
      proposals: 0,
      description: draft.details || (isZh ? '这是一条通过前端模拟发布的新 AI 需求。' : 'This AI request was created in the local front-end flow.'),
      publisher: 'you',
      assignee: 'Unassigned',
      requirements: isZh
        ? [
            draft.rules || '提交预览链接、最终文件、提示词和验收说明。',
            `可见范围：${draft.visibility}`,
            '这条内容由本地前端模拟流程创建。',
          ]
        : [
            draft.rules || 'Submit preview links, final files, prompts, and acceptance notes.',
            `Visibility: ${draft.visibility}`,
            'This item was created in the local front-end flow.',
          ],
      attachments: [isZh ? '本地模拟附件.md' : 'local-demo-attachment.md'],
      privateBrief: isZh ? '这是本地前端模拟发布的私密需求说明。' : 'Private brief created by the local front-end publish flow.',
      submission: isZh ? '等待接单者提交成果。' : 'Waiting for an assignee to submit deliverables.',
      resultLinks: [isZh ? '等待提交' : 'Waiting for submission'],
      reviewNote: isZh ? '发布成功，等待创作者接取。' : 'Published successfully. Waiting for a maker to claim it.',
      rights: isZh ? '按发布需求约定使用，当前为前端模拟数据。' : 'Usage follows the posted brief. This is front-end demo data.',
    }
    setTaskList((current) => [newTask, ...current])
    setSelectedTask(newTask)
    pushLedger(isZh ? `发布任务：${newTask.title}` : `Published task: ${newTask.title}`, '+20')
    pushToast(isZh ? `已发布任务：${newTask.title}` : `Task published: ${newTask.title}`)
    setPage('tasks')
  }

  const claimTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'In Progress',
      assignee: 'you',
      proposals: task.proposals + 1,
      reviewNote: isZh ? '你已接取任务，请在我的任务中提交成果。' : 'You claimed this task. Submit deliverables from My Tasks.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `接取任务：${task.title}` : `Claimed task: ${task.title}`, '+50')
    pushToast(isZh ? `已接取任务：${task.title}` : `Task claimed: ${task.title}`)
    setPage('mine')
  }

  const submitTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Pending Review',
      assignee: task.assignee === 'Unassigned' ? 'you' : task.assignee,
      submission: isZh
        ? '已提交：预览链接、最终文件、提示词、修订说明和版权摘要。'
        : 'Submitted: preview links, final files, prompt notes, revision summary, and rights note.',
      resultLinks: isZh ? ['网盘/本地模拟交付包', '录屏/验收讲解'] : ['drive/local-demo-delivery', 'loom/local-review-walkthrough'],
      reviewNote: isZh ? '成果已提交，等待发布方验收。' : 'Deliverables submitted. Waiting for publisher review.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `提交成果：${task.title}` : `Submitted deliverable: ${task.title}`, '+120')
    pushToast(isZh ? `已提交成果：${task.title}` : `Deliverable submitted: ${task.title}`)
    setPage('mine')
  }

  const approveTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Completed',
      reviewNote: isZh ? '验收通过，积分已发放，贡献履历已更新。' : 'Accepted. Points released and contribution history updated.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `验收通过：${task.title}` : `Accepted task: ${task.title}`, `+${task.points.replace(/[^\d]/g, '') || '500'}`)
    pushToast(isZh ? `验收通过：${task.title}` : `Task accepted: ${task.title}`)
    setPage('points')
  }

  const rejectTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Rejected',
      reviewNote: isZh
        ? '已驳回：请补充更明确的交付链接、验收说明和版权确认后重新提交。'
        : 'Rejected: add clearer delivery links, acceptance notes, and rights confirmation before resubmitting.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushToast(isZh ? `已驳回任务：${task.title}` : `Task rejected: ${task.title}`)
  }

  const createPost = (draft?: CommunityDraft) => {
    const isZh = locale === 'zh'
    const newPost: Post = {
      id: Date.now(),
      title:
        draft?.title ||
        (isZh ? '我刚发布了一个 AI 任务，求优化验收标准' : 'I just posted an AI task. Can you review the acceptance criteria?'),
      category: draft?.category || (isZh ? '提问' : 'Questions'),
      author: 'you',
      replies: 0,
      likes: '0',
      views: '1',
      votes: 0,
      tag: isZh ? '新帖' : 'New',
      solved: false,
      excerpt:
        draft?.excerpt ||
        (isZh
          ? '这是通过前端模拟流程创建的新社区帖子，可以继续转任务或收入灵感库。'
          : 'Created from the local front-end flow. It can be converted to a task or saved to the library.'),
      body:
        draft?.excerpt ||
        (isZh
          ? '请大家帮我看一下这个需求是否清晰：目标、交付物、验收标准、版权范围和修改轮次是否还缺什么？'
          : 'Please help review whether this brief is clear enough: goals, deliverables, acceptance criteria, rights, and revision rounds.'),
    }
    setPostList((current) => [newPost, ...current])
    setSelectedPost(newPost)
    pushLedger(isZh ? `发布社区帖子：${newPost.title}` : `Published community post: ${newPost.title}`, '+30')
    pushToast(isZh ? `已发布帖子：${newPost.title}` : `Post published: ${newPost.title}`)
    setPage('community')
  }

  const likePost = (post: Post) => {
    const isZh = locale === 'zh'
    const updated = {
      ...post,
      likes: bumpLikeCount(post.likes),
      votes: post.votes + 1,
    }
    setPostList((current) => current.map((item) => (item.id === post.id ? updated : item)))
    setSelectedPost(updated)
    pushLedger(isZh ? `点赞社区帖子：${post.title}` : `Liked community post: ${post.title}`, '+5')
    pushToast(isZh ? `已点赞帖子：${post.title}` : `Post liked: ${post.title}`)
  }

  const replyToPost = (post: Post, replyText?: string) => {
    const isZh = locale === 'zh'
    const updated = {
      ...post,
      replies: post.replies + 1,
      views: post.views === '1' ? '2' : post.views,
    }
    setPostList((current) => current.map((item) => (item.id === post.id ? updated : item)))
    setSelectedPost(updated)
    pushLedger(isZh ? `回复社区帖子：${post.title}` : `Replied to community post: ${post.title}`, '+15')
    pushToast(
      replyText
        ? isZh
          ? `已发表回复：${replyText.slice(0, 28)}`
          : `Reply posted: ${replyText.slice(0, 28)}`
        : isZh
          ? `已模拟回复：${post.title}`
          : `Reply simulated: ${post.title}`,
    )
  }

  const convertPostToTask = (post: Post) => {
    const isZh = locale === 'zh'
    publishTask({
      title: isZh ? `来自社区：${post.title}` : `From community: ${post.title}`,
      category: 'Prompt',
      reward: isZh ? '¥800 / 800 积分' : '$120 / 800 pts',
      deadline: isZh ? '3 天' : '3 days',
      visibility: isZh ? '社区可见' : 'Community visible',
      details: post.excerpt,
      rules: isZh
        ? '请提交方案、参考链接、可复用提示词和验收说明。'
        : 'Submit a plan, reference links, reusable prompts, and acceptance notes.',
    })
  }

  const savePostToLibrary = (post: Post) => {
    const isZh = locale === 'zh'
    const item: InspirationItem = {
      title: post.title,
      type: post.category,
      source: isZh ? '社区' : 'Community',
      saves: '1',
      text: post.excerpt,
    }
    setLibraryItems((current) => [item, ...current])
    pushLedger(isZh ? `收入灵感库：${post.title}` : `Saved to inspiration library: ${post.title}`, '+10')
    pushToast(isZh ? `已收入灵感库：${post.title}` : `Saved to inspiration library: ${post.title}`)
    setPage('inspiration')
  }

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className={sidebarCollapsed ? 'sidebar mobile-expanded collapsed' : 'sidebar'}>
        <button className="brand" type="button" onClick={() => setPage('home')}>
          <span className="brand-mark">
            <Sparkles size={22} />
          </span>
          <span>{t.brand}</span>
        </button>

        <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)}>
          <Search size={18} />
          <span>{t.search}</span>
          <kbd>Ctrl K</kbd>
        </button>

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={page === item.key ? 'nav-item active' : 'nav-item'}
                key={item.key}
                type="button"
                onClick={() => {
                  setPage(item.key)
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="library">
          <span className="eyebrow">{t.library}</span>
          <button type="button" onClick={() => openProfile(selectedProfile)}>
            <UserRound size={17} />
            {t.profile}
          </button>
          <button type="button" onClick={requireAuth}>
            <Heart size={17} />
            {t.liked}
          </button>
          <button type="button" onClick={requireAuth}>
            <Plus size={17} />
            {t.newPlaylist}
          </button>
        </div>

        <button
          className="language"
          type="button"
          onClick={() => {
            const nextLocale = locale === 'en' ? 'zh' : 'en'
            const nextCopy = copy[nextLocale]
            setLocale(nextLocale)
            setSelectedTask(localeFirstTask(taskList, nextCopy))
            setSelectedPost(localeFirstPost(postList, nextCopy))
            setSelectedSearchFilter(nextCopy.all)
            setPrompt(
              nextLocale === 'zh'
                ? '国风 Lo-fi 歌单片头，古筝采样，轻鼓点，夜色城市氛围'
                : 'Lo-fi instrumental song for late-night coding',
            )
            pushToast(nextLocale === 'zh' ? '已切换为中文内容。' : 'Switched to English content.')
          }}
        >
          <Languages size={16} />
          {locale === 'en' ? '中文' : 'English'}
        </button>

        <div className="footer-links">
          {footerItems.map((item) => (
            <button type="button" key={item.key} onClick={() => setPage(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            onClick={() => {
              setSidebarCollapsed((open) => !open)
              pushToast(
                locale === 'zh'
                  ? sidebarCollapsed
                    ? '已展开侧边栏'
                    : '已收起侧边栏'
                  : sidebarCollapsed
                    ? 'Sidebar expanded'
                    : 'Sidebar collapsed',
              )
            }}
            aria-label={sidebarCollapsed ? textFor(t, 'Expand sidebar', '展开侧边栏') : textFor(t, 'Collapse sidebar', '收起侧边栏')}
            aria-expanded={!sidebarCollapsed}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-status">
            <Bell size={17} />
            <span>{textFor(t, 'AI generation queue is clear', 'AI 生成队列已清空')}</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={() => setLoginOpen(true)}>
              <LogIn size={17} />
              {t.login}
            </button>
            <button className="primary-button" type="button" onClick={() => setPage('create')}>
              <Sparkles size={17} />
              {t.getStarted}
            </button>
          </div>
        </header>

        <div className={page === 'tasks' ? 'page task-page' : 'page'}>
          {page === 'home' && (
            <HomePage t={t} setPage={setPage} playTrack={playTrack} />
          )}
          {page === 'create' && (
            <CreatePage
              key={locale}
              t={t}
              prompt={prompt}
              setPrompt={setPrompt}
              generationState={generationState}
              runGenerate={runGenerate}
              playTrack={playTrack}
              simulateAction={simulateAction}
            />
          )}
          {page === 'chat' && <ChatPage key={locale} t={t} setPage={setPage} simulateAction={simulateAction} />}
          {page === 'image' && <ImagePage key={locale} t={t} requireAuth={requireAuth} setPage={setPage} simulateAction={simulateAction} />}
          {page === 'video' && <VideoPage key={locale} t={t} requireAuth={requireAuth} simulateAction={simulateAction} />}
          {page === 'engine' && <EnginePage key={locale} t={t} setPage={setPage} simulateAction={simulateAction} />}
          {page === 'explore' && (
            <ExplorePage t={t} playTrack={playTrack} setPage={setPage} requireAuth={requireAuth} />
          )}
          {page === 'tasks' && (
            <TasksPage
              key={locale}
              t={t}
              tasks={taskList}
              setPage={setPage}
              openProfile={openProfile}
              claimTask={claimTask}
              submitTask={submitTask}
              selectedTask={selectedTask}
              setSelectedTask={setSelectedTask}
              simulateAction={simulateAction}
            />
          )}
          {page === 'publish' && (
            <PublishPage
              key={locale}
              t={t}
              setPage={setPage}
              requireAuth={requireAuth}
              publishTask={publishTask}
              openProfile={openProfile}
              simulateAction={simulateAction}
            />
          )}
          {page === 'mine' && <MyTasksPage key={locale} t={t} tasks={taskList} setPage={setPage} submitTask={submitTask} simulateAction={simulateAction} />}
          {page === 'community' && (
            <CommunityPage
              key={locale}
              t={t}
              posts={postList}
              createPost={createPost}
              convertPostToTask={convertPostToTask}
              savePostToLibrary={savePostToLibrary}
              likePost={likePost}
              replyToPost={replyToPost}
              openProfile={openProfile}
              selectedPost={selectedPost}
              setSelectedPost={setSelectedPost}
              communityFilter={communityFilter}
              setCommunityFilter={setCommunityFilter}
              simulateAction={simulateAction}
            />
          )}
          {page === 'inspiration' && <InspirationPage key={locale} t={t} items={libraryItems} setPage={setPage} simulateAction={simulateAction} />}
          {page === 'points' && <PointsPage key={locale} t={t} ledger={ledgerItems} simulateAction={simulateAction} />}
          {page === 'admin' && <AdminPage key={locale} t={t} selectedTask={selectedTask} setPage={setPage} approveTask={approveTask} rejectTask={rejectTask} simulateAction={simulateAction} />}
          {page === 'pricing' && (
            <PricingPage key={locale} t={t} billing={billing} setBilling={setBilling} requireAuth={requireAuth} />
          )}
          {page === 'api' && <ApiPage key={locale} t={t} requireAuth={requireAuth} simulateAction={simulateAction} />}
          {page === 'earn' && <EarnPage key={locale} t={t} requireAuth={requireAuth} />}
          {page === 'about' && <AboutPage key={locale} t={t} />}
          {page === 'playlist' && <PlaylistPage t={t} playTrack={playTrack} simulateAction={simulateAction} />}
          {page === 'profile' && (
            <ProfilePage
              key={locale}
              t={t}
              profile={selectedProfile}
              setPage={setPage}
              openProfile={openProfile}
              simulateAction={simulateAction}
            />
          )}
          {page === 'terms' && <LegalPage title={t.terms} t={t} />}
          {page === 'privacy' && <LegalPage title={t.privacy} t={t} />}
        </div>
      </main>

      <MiniPlayer
        t={t}
        track={activeTrack}
        playTrack={playTrack}
        playing={playing}
        setPlaying={setPlaying}
        playerOpen={playerOpen}
        setPlayerOpen={setPlayerOpen}
        requireAuth={requireAuth}
        simulateAction={simulateAction}
      />

      {searchOpen && (
        <SearchPanel
          t={t}
          close={() => setSearchOpen(false)}
          playTrack={playTrack}
          setPage={setPage}
          openProfile={openProfile}
          selectedSearchFilter={selectedSearchFilter}
          setSelectedSearchFilter={setSelectedSearchFilter}
          simulateAction={simulateAction}
        />
      )}
      {loginOpen && <LoginModal t={t} close={() => setLoginOpen(false)} simulateAction={simulateAction} />}
      <DynamicIsland locale={locale} page={page} setPage={setPage} simulateAction={simulateAction} />
    </div>
  )
}

function CompassIcon(props: { size: number }) {
  return <Radio size={props.size} />
}

function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}

function HomePage({
  t,
  setPage,
  playTrack,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  playTrack: (track: Track) => void
}) {
  const moveHeroGlow = (event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`)
    event.currentTarget.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`)
  }
  const isZh = isZhCopy(t)
  const featuredTask = isZh ? tasks.find((task) => hasCjk(task.title)) ?? tasks[0] : tasks[0]

  return (
    <div className="stack">
      <section className="hero-section interactive-hero" onPointerMove={moveHeroGlow} onMouseMove={moveHeroGlow}>
        <div className="hero-fx" aria-hidden="true">
          <span className="fx-orbit orbit-a" />
          <span className="fx-orbit orbit-b" />
          <span className="fx-node node-a" />
          <span className="fx-node node-b" />
          <span className="fx-node node-c" />
        </div>
        <div className="hero-copy">
          <span className="pill">
            <BriefcaseBusiness size={16} />
            {textFor(t, 'AI Work Marketplace', 'AI 任务协作平台')}
          </span>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroText}</p>
          <div className="button-row">
            <button className="primary-button large" type="button" onClick={() => setPage('tasks')}>
              <BriefcaseBusiness size={18} />
              {t.startCreating}
            </button>
            <button className="ghost-button large" type="button" onClick={() => setPage('publish')}>
              <PenLine size={18} />
              {t.publish}
            </button>
            <button className="ghost-button large" type="button" onClick={() => setPage('community')}>
              <MessageCircle size={18} />
              {t.community}
            </button>
          </div>
        </div>
        <div className="hero-market-card">
          <div className="market-card-top">
            <span className="status-badge open">{statusLabel(featuredTask.status, t)}</span>
            <strong>{featuredTask.budget}</strong>
          </div>
          <div>
            <span className="eyebrow">{textFor(t, 'Featured task', '精选任务')}</span>
            <h3>{featuredTask.title}</h3>
            <p>{featuredTask.description}</p>
          </div>
          <div className="market-metrics">
            <span>{featuredTask.proposals} {textFor(t, 'proposals', '个提案')}</span>
            <span>{featuredTask.deadline}</span>
            <span>{categoryLabel(featuredTask.category, t)}</span>
          </div>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
              {textFor(t, 'View task', '查看任务')}
            </button>
            <button className="ghost-button" type="button" onClick={() => setPage('community')}>
              {textFor(t, 'Discuss', '去社区讨论')}
            </button>
          </div>
        </div>
      </section>

      <div className="feature-strip">
        {(isZh
          ? ['发布 AI 需求', '接取付费任务', '展示交付作品', '讨论提示词']
          : ['Post AI requests', 'Accept paid tasks', 'Showcase work', 'Discuss prompts']
        ).map((item) => (
          <span key={item}>
            <Check size={17} />
            {item}
          </span>
        ))}
      </div>

      <DashboardOverview t={t} setPage={setPage} />
      <MarketplaceOverview t={t} setPage={setPage} />
      <CommunityOverview t={t} setPage={setPage} />
      <ExplorePreview t={t} playTrack={playTrack} setPage={setPage} />
    </div>
  )
}

function DashboardOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const cards = isZhCopy(t)
    ? [
        ['发布需求', '把粗略想法整理成有奖励、周期、附件和验收标准的 AI 任务。', 'publish' as Page],
        ['AI 任务引擎', '发布前先拆解需求、估算积分并匹配合适创作者。', 'engine' as Page],
        ['我的任务台', '跟踪已接取任务、提交交付物、回复验收意见并沉淀履历。', 'mine' as Page],
      ]
    : [
        ['Publish request', 'Turn a rough idea into a scoped AI task with reward, deadline, attachments, and acceptance rules.', 'publish' as Page],
        ['AI task engine', 'Split requirements, estimate points, and match makers before the task goes live.', 'engine' as Page],
        ['My task desk', 'Track claimed work, submit deliverables, answer review notes, and build contribution history.', 'mine' as Page],
      ]

  return (
    <section>
      <SectionHeader eyebrow={textFor(t, 'Workspace', '工作台')} title={t.dashboardTitle} />
      <div className="core-grid">
        {cards.map(([title, text, target]) => (
          <button className="core-action-card" type="button" key={title} onClick={() => setPage(target as Page)}>
            <span className="pill small">
              {isZhCopy(t) ? copy.zh[target as keyof typeof copy.zh] ?? target : copy.en[target as keyof typeof copy.en] ?? target}
            </span>
            <strong>{title}</strong>
            <p>{text}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

function MarketplaceOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const previewTasks = localizedTasks(tasks, t).slice(0, 3)
  return (
    <section>
      <SectionHeader
        eyebrow={textFor(t, 'Core', '核心')}
        title={t.tasksTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
            <Plus size={17} />
            {t.postTask}
          </button>
        }
      />
      <div className="core-grid">
        {previewTasks.map((task) => (
          <article className="core-task-card" key={task.id}>
            <div className="market-card-top">
              <StatusBadge status={task.status} t={t} />
              <strong>{task.budget}</strong>
            </div>
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <div className="market-metrics">
              <span>{categoryLabel(task.category, t)}</span>
              <span>{task.deadline}</span>
              <span>{task.proposals} {textFor(t, 'proposals', '个提案')}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function CommunityOverview({
  t,
  setPage,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const previewPosts = localizedPosts(posts, t)
  return (
    <section>
      <SectionHeader
        eyebrow={textFor(t, 'Core', '核心')}
        title={t.communityTitle}
        action={
          <button className="ghost-button" type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            {t.community}
          </button>
        }
      />
      <div className="core-grid community-core">
        {previewPosts.map((post) => (
          <article className="core-post-card" key={post.id}>
            <span className="pill small">{post.tag}</span>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <span>
              @{post.author} · {post.replies} {textFor(t, 'replies', '条回复')} · {post.likes} {textFor(t, 'likes', '点赞')}
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}

function CreatePage({
  t,
  prompt,
  setPrompt,
  generationState,
  runGenerate,
  playTrack,
  simulateAction,
}: {
  t: Record<string, string>
  prompt: string
  setPrompt: (value: string) => void
  generationState: 'idle' | 'loading' | 'done'
  runGenerate: () => void
  playTrack: (track: Track) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [mode, setMode] = useState<'instrumental' | 'lyrics'>('instrumental')
  const [activeTool, setActiveTool] = useState('song')
  const tools = [
    {
      key: 'song',
      label: t.createSong,
      icon: Music2,
      prompt: textFor(t, 'Lo-fi instrumental song for late-night coding, warm keys, clean drums', '国风 Lo-fi 歌单片头，古筝采样，轻鼓点，夜色城市氛围'),
    },
    {
      key: 'voice',
      label: t.createVoice,
      icon: Mic2,
      prompt: textFor(t, 'Trustworthy product launch narrator, warm, concise, commercial-ready', '中文课程宣传片旁白，专业、克制、有信任感'),
    },
    {
      key: 'tts',
      label: t.textToSpeech,
      icon: FileText,
      prompt: textFor(t, 'Read this product value proposition as a 20-second ad voiceover', '把这段课程卖点朗读成 20 秒中文广告口播'),
    },
    { key: 'replace', label: t.replaceFile, icon: Upload, prompt },
    {
      key: 'random',
      label: t.random,
      icon: Shuffle,
      prompt: textFor(t, 'Cinematic city-pop chorus, glossy synth bass, late-summer night drive', '国风 Lo-fi 歌单片头，古筝采样，轻鼓点，夜色城市氛围'),
    },
  ]

  const handleGenerate = () => {
    runGenerate()
    simulateAction(isZh ? '已加入生成队列：音乐/声音方案正在模拟生成' : 'Added to generation queue: music and voice concept is rendering')
  }

  const selectTool = (tool: (typeof tools)[number]) => {
    setActiveTool(tool.key)
    if (tool.key !== 'replace') {
      setPrompt(tool.prompt)
    }
    simulateAction(isZh ? `已选择工具：${tool.label}` : `Selected tool: ${tool.label}`)
  }

  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Music Studio', '音乐工作台')} title={textFor(t, 'Create AI songs and voice assets', '创作 AI 歌曲和声音素材')} />
      <section className="composer">
        <div className="composer-top">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} />
          <div className="composer-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => simulateAction(isZh ? '已模拟上传参考文件：demo-reference.wav' : 'Reference file uploaded: demo-reference.wav')}
            >
              <Upload size={18} />
            </button>
            <button
              className="icon-button pro"
              type="button"
              onClick={() => simulateAction(isZh ? '已开启 Pro 参数预设：高质量、可商用、保留工程说明' : 'Pro preset enabled: high quality, commercial use, project notes')}
            >
              <Zap size={18} />
            </button>
          </div>
        </div>
        <div className="mode-row">
          <button
            className={mode === 'instrumental' ? 'chip active' : 'chip'}
            type="button"
            onClick={() => {
              setMode('instrumental')
              simulateAction(isZh ? '已切换到伴奏模式' : 'Switched to instrumental mode')
            }}
          >
            <Music2 size={16} />
            {t.instrumental}
          </button>
          <button
            className={mode === 'lyrics' ? 'chip active' : 'chip'}
            type="button"
            onClick={() => {
              setMode('lyrics')
              simulateAction(isZh ? '已切换到 lyrics 模式' : 'Switched to lyrics mode')
            }}
          >
            <PenLine size={16} />
            {t.lyrics}
          </button>
          <button className="primary-button" type="button" onClick={handleGenerate}>
            <Send size={17} />
            {generationState === 'loading' ? t.generating : t.generate}
          </button>
        </div>
      </section>

      <div className="tool-grid">
        {tools.map((tool) => {
          const Icon = tool.icon
          return (
            <button
              className={activeTool === tool.key ? 'tool-card active' : 'tool-card'}
              type="button"
              key={tool.label}
              onClick={() => selectTool(tool)}
            >
              <Icon size={20} />
              <span>{tool.label}</span>
            </button>
          )
        })}
      </div>

      <section className="content-grid two">
        <div className="panel">
          <SectionHeader title={textFor(t, 'Generation queue', '生成队列')} />
          <div className="queue-list">
            <QueueItem t={t} state={generationState} title={prompt || textFor(t, 'Untitled song', '未命名歌曲')} />
            <QueueItem t={t} state="done" title={textFor(t, 'Warm cinematic intro with female vocal', '温暖电影感女声片头')} />
            <QueueItem t={t} state="idle" title={textFor(t, 'Future bass chorus idea', 'Future bass 副歌灵感')} />
          </div>
        </div>
        <div className="panel">
          <SectionHeader title={textFor(t, 'Recent results', '最近结果')} />
          <div className="mini-list">
            {tracks.slice(0, 3).map((track) => (
            <TrackRow key={track.id} t={t} track={track} playTrack={playTrack} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function QueueItem({ t, state, title }: { t: Record<string, string>; state: 'idle' | 'loading' | 'done'; title: string }) {
  return (
    <div className="queue-item">
      <span className={`status-dot ${state}`} />
      <div>
        <strong>{title}</strong>
        <p>
          {state === 'loading'
            ? textFor(t, 'Rendering variations...', '正在渲染变体...')
            : state === 'done'
              ? textFor(t, 'Ready for review', '可预览验收')
              : textFor(t, 'Waiting', '等待中')}
        </p>
      </div>
    </div>
  )
}

function ChatPage({
  t,
  setPage,
  simulateAction,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const quickPrompts = isZh
    ? [
        ['写歌词', '根据情绪生成一段主歌和副歌。'],
        ['优化提示词', '把提示词改得更具体、更可直接使用。'],
        ['视频脚本', '把歌曲拆成逐镜头画面。'],
        ['任务需求', '写一份清晰的任务广场买家需求。'],
      ]
    : [
        ['Write lyrics', 'Generate a verse and chorus from a mood.'],
        ['Improve prompt', 'Make a prompt more specific and usable.'],
        ['Video script', 'Turn a song into scene-by-scene shots.'],
        ['Task brief', 'Write a clear buyer request for Task Plaza.'],
      ]
  const [messages, setMessages] = useState(
    isZh
      ? [
          { role: 'assistant', text: '我可以帮你写歌词、提示词、视频脚本、任务需求和社区帖子。' },
          { role: 'user', text: '把这个国风 Lo-fi 想法改成副歌提示词。' },
          { role: 'assistant', text: '可以这样写：轻松国风 Lo-fi 副歌，温暖人声，古筝点缀，雨夜城市氛围，旋律适合循环。' },
        ]
      : [
          { role: 'assistant', text: 'I can help write lyrics, prompts, video scripts, task briefs, and community posts.' },
          { role: 'user', text: 'Turn this lofi idea into a chorus prompt.' },
          { role: 'assistant', text: 'Try: mellow city-pop chorus, intimate vocal, warm Rhodes, rain texture, hook about staying awake until sunrise.' },
        ],
  )
  const [draft, setDraft] = useState('')

  const sendMessage = () => {
    if (!draft.trim()) return
    setMessages((current) => [
      ...current,
      { role: 'user', text: draft },
      {
        role: 'assistant',
        text: isZh ? '已生成草稿。你可以继续改写，或发送到音乐、图片、视频、任务广场。' : 'Drafted. You can send this to Music, Image, Video, or Task Plaza.',
      },
    ])
    setDraft('')
  }

  const applyPrompt = (title: string, text: string) => {
    const promptText = isZh
      ? `${title}: ${text} 请给我一个可直接用于任务广场或创作工具的中文版本。`
      : `${title}: ${text} Give me a production-ready version for the task plaza or creation tools.`
    setDraft(promptText)
    setMessages((current) => [
      ...current,
      { role: 'user', text: promptText },
      {
        role: 'assistant',
        text: isZh
          ? `已按「${title}」生成一版草稿，你可以继续修改或发送到对应工具。`
          : `I drafted a version for "${title}". You can refine it or send it to the matching tool.`,
      },
    ])
    simulateAction(isZh ? `已应用快捷提示：${title}` : `Quick prompt applied: ${title}`)
  }

  return (
    <div className="studio-layout">
      <section className="panel chat-panel">
        <SectionHeader eyebrow={textFor(t, 'Assistant', '助手')} title={t.chatTitle} />
        <p className="muted">{t.chatSubtitle}</p>
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={textFor(t, 'Ask for lyrics, prompts, scripts...', '输入歌词、提示词、脚本或任务需求...')}
          />
          <button className="primary-button" type="button" onClick={sendMessage}>
            <Send size={17} />
          </button>
        </div>
      </section>
      <aside className="panel side-panel">
        <SectionHeader title={textFor(t, 'Quick prompts', '快捷提示')} />
        {quickPrompts.map(([title, text]) => (
          <button className="prompt-card" type="button" key={title} onClick={() => applyPrompt(title, text)}>
            <strong>{title}</strong>
            <span>{text}</span>
          </button>
        ))}
        <div className="button-row vertical">
          <button className="ghost-button" type="button" onClick={() => setPage('create')}>
            <Music2 size={17} />
            {textFor(t, 'Send to Music', '发送到音乐')}
          </button>
          <button className="ghost-button" type="button" onClick={() => setPage('video')}>
            <Clapperboard size={17} />
            {textFor(t, 'Send to Video', '发送到视频')}
          </button>
        </div>
      </aside>
    </div>
  )
}

function ImagePage({
  t,
  requireAuth,
  setPage,
  simulateAction,
}: {
  t: Record<string, string>
  requireAuth: () => void
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  return (
    <StudioPage
      t={t}
      eyebrow={textFor(t, 'Visual AI', '视觉 AI')}
      title={t.imageTitle}
      subtitle={t.imageSubtitle}
      icon={<Image size={22} />}
      prompt={textFor(t, 'Minimal album cover, chrome flower, cinematic lighting, black background', '小红书美妆产品图，高级干净光线，真实质感，适合封面')}
      primaryAction={textFor(t, 'Generate images', '生成图片')}
      options={
        isZh
          ? ['文生图', '图生图', '海报', '头像', '商品图', 'Logo 概念']
          : ['Text to Image', 'Image to Image', 'Poster', 'Avatar', 'Product Visual', 'Logo Concept']
      }
      controls={isZh ? ['1:1', '16:9', '4:5', '风格强度 70%', '4 张输出', '高清'] : ['1:1', '16:9', '4:5', 'Style strength 70%', '4 outputs', 'HD']}
      results={visualWorks.filter((item) => item.type === 'Image')}
      requireAuth={requireAuth}
      simulateAction={simulateAction}
      extraAction={() => setPage('video')}
      extraActionLabel={textFor(t, 'Send to Video', '发送到视频')}
    />
  )
}

function VideoPage({
  t,
  requireAuth,
  simulateAction,
}: {
  t: Record<string, string>
  requireAuth: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  return (
    <StudioPage
      t={t}
      eyebrow={textFor(t, 'Motion AI', '视频 AI')}
      title={t.videoTitle}
      subtitle={t.videoSubtitle}
      icon={<Clapperboard size={22} />}
      prompt={textFor(t, 'A neon runner crosses a rainy city street while lyrics animate in sync', '中文课程宣传短视频，讲师照片转场，字幕同步，专业克制')}
      primaryAction={textFor(t, 'Generate video', '生成视频')}
      options={isZh ? ['文生视频', '图生视频', '音乐视频', '分镜', '字幕', '配音'] : ['Text to Video', 'Image to Video', 'Music Video', 'Storyboard', 'Subtitles', 'Voiceover']}
      controls={isZh ? ['9:16', '8 秒', '电影感', '快切', '开启字幕', 'MP4'] : ['9:16', '8 sec', 'Cinematic', 'Fast cuts', 'Captions on', 'MP4']}
      results={visualWorks.filter((item) => item.type === 'Video')}
      requireAuth={requireAuth}
      simulateAction={simulateAction}
    />
  )
}

function StudioPage({
  t,
  eyebrow,
  title,
  subtitle,
  icon,
  prompt,
  primaryAction,
  options,
  controls,
  results,
  requireAuth,
  simulateAction,
  extraAction,
  extraActionLabel,
}: {
  t: Record<string, string>
  eyebrow: string
  title: string
  subtitle: string
  icon: ReactNode
  prompt: string
  primaryAction: string
  options: string[]
  controls: string[]
  results: Work[]
  requireAuth: () => void
  simulateAction: SimulateAction
  extraAction?: () => void
  extraActionLabel?: string
}) {
  const isZh = isZhCopy(t)
  const [activeOption, setActiveOption] = useState(options[0])
  const [activeControls, setActiveControls] = useState<string[]>([controls[0]])
  const [renderState, setRenderState] = useState<'idle' | 'loading' | 'done'>('idle')

  const toggleControl = (control: string) => {
    setActiveControls((current) =>
      current.includes(control) ? current.filter((item) => item !== control) : [...current, control],
    )
    simulateAction(isZh ? `已切换参数：${control}` : `Control changed: ${control}`)
  }

  const runStudioGenerate = () => {
    setRenderState('loading')
    simulateAction(isZh ? `已开始模拟生成：${activeOption}` : `Generation started: ${activeOption}`)
    window.setTimeout(() => {
      setRenderState('done')
      simulateAction(isZh ? `生成完成：${activeOption} 已加入结果区` : `Generated: ${activeOption} added to results`)
    }, 800)
  }

  return (
    <div className="stack">
      <section className="studio-hero">
        <div className="studio-icon">{icon}</div>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </section>
      <section className="composer">
        <textarea defaultValue={prompt} />
        <div className="chip-row">
          {options.map((option) => (
            <button
              className={activeOption === option ? 'chip active' : 'chip'}
              type="button"
              key={option}
              onClick={() => {
                setActiveOption(option)
                simulateAction(isZh ? `已选择生成模式：${option}` : `Generation mode selected: ${option}`)
              }}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="control-grid">
          {controls.map((control) => (
            <button
              className={activeControls.includes(control) ? 'control-pill active' : 'control-pill'}
              type="button"
              key={control}
              onClick={() => toggleControl(control)}
            >
              {control}
              <ChevronDown size={14} />
            </button>
          ))}
        </div>
        <div className="button-row">
          <button className="primary-button" type="button" onClick={runStudioGenerate}>
            <Sparkles size={17} />
            {renderState === 'loading' ? t.generating : renderState === 'done' ? t.generated : primaryAction}
          </button>
          {extraAction && (
            <button className="ghost-button" type="button" onClick={extraAction}>
              <Clapperboard size={17} />
              {extraActionLabel}
            </button>
          )}
        </div>
      </section>

      <section className="visual-grid">
        {results.map((work) => (
          <article className="visual-card" key={work.title}>
            <img src={work.image} alt="" />
            <div>
              <strong>{work.title}</strong>
              <span>
                {work.creator} · {work.views}
                {' '}
                {textFor(t, 'views', '浏览')}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => simulateAction(isZh ? `已重新混合：${work.title}` : `Remixed: ${work.title}`)}>
                <RefreshCcw size={16} />
              </button>
              <button type="button" onClick={requireAuth}>
                <Download size={16} />
              </button>
              <button type="button" onClick={requireAuth}>
                <Share2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

function ExplorePage({
  t,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth: () => void
}) {
  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Live discovery', '实时发现')} title={t.radio} />
      <RadioCarousel t={t} playTrack={playTrack} />
      <div className="feature-strip compact">
        {[t.unlimitedStreaming, t.freeDownloads, t.noCopyright, t.royaltyFree].map((item) => (
          <span key={item}>
            <Check size={16} />
            {item}
          </span>
        ))}
      </div>
      <ExplorePreview t={t} playTrack={playTrack} setPage={setPage} requireAuth={requireAuth} />
    </div>
  )
}

function ExplorePreview({
  t,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth?: () => void
}) {
  return (
    <div className="stack">
      <section>
        <SectionHeader title={t.trending} action={<button className="ghost-button" type="button" onClick={() => setPage('playlist')}>{t.playlists}</button>} />
        <div className="track-grid">
          {tracks.map((track) => (
            <TrackCard key={track.id} t={t} track={track} playTrack={playTrack} setPage={setPage} requireAuth={requireAuth} />
          ))}
        </div>
      </section>
      <section>
        <SectionHeader title={textFor(t, 'Trending images & videos', '热门图片与视频')} />
        <div className="visual-grid small">
          {visualWorks.map((work) => (
            <article className="visual-card" key={work.title}>
              <img src={work.image} alt="" />
              <div>
                <strong>{work.title}</strong>
                <span>
                  {mediaTypeLabel(work.type, t)} · {work.creator} · {work.views} {textFor(t, 'views', '浏览')}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function RadioCarousel({ t, playTrack }: { t: Record<string, string>; playTrack: (track: Track) => void }) {
  return (
    <div className="radio-row">
      {radioStations.map((station, index) => (
        <article className="radio-card" key={station.title}>
          <img src={station.image} alt="" />
          <button type="button" onClick={() => playTrack(tracks[index % tracks.length])}>
            <Play size={17} fill="currentColor" />
            {textFor(t, 'Live', '直播')}
          </button>
          <div>
            <strong>{station.title}</strong>
            <span>
              {station.host} · {station.listeners} {textFor(t, 'listening', '人在听')}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}

function TrackCard({
  t,
  track,
  playTrack,
  setPage,
  requireAuth,
}: {
  t: Record<string, string>
  track: Track
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  requireAuth?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <article className="track-card">
      <button className="track-play" type="button" onClick={() => playTrack(track)}>
        <img src={track.cover} alt="" />
        <span>
          <Play size={18} fill="currentColor" />
        </span>
      </button>
      <div className="track-meta">
        <button type="button" onClick={() => playTrack(track)}>
          {track.title}
        </button>
        <span>
          <button type="button" onClick={() => setPage('profile')}>
            {track.artist}
          </button>
          · {track.plays} {textFor(t, 'plays', '播放')}
        </span>
      </div>
      <div className="more-wrap">
        <button className="icon-button small" type="button" onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizontal size={17} />
        </button>
        {menuOpen && (
          <div className="floating-menu">
            <button type="button" onClick={() => playTrack(track)}>
              <Play size={15} />
              {textFor(t, 'Play', '播放')}
            </button>
            <button type="button" onClick={requireAuth}>
              <Heart size={15} />
              {textFor(t, 'Like', '喜欢')}
            </button>
            <button type="button" onClick={requireAuth}>
              <Download size={15} />
              {textFor(t, 'Download', '下载')}
            </button>
            <button type="button" onClick={requireAuth}>
              <ListMusic size={15} />
              {textFor(t, 'Add to playlist', '加入播放列表')}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

function TrackRow({ t, track, playTrack }: { t: Record<string, string>; track: Track; playTrack: (track: Track) => void }) {
  return (
    <div className="track-row">
      <button type="button" onClick={() => playTrack(track)}>
        <img src={track.cover} alt="" />
        <Play size={14} fill="currentColor" />
      </button>
      <div>
        <strong>{track.title}</strong>
        <span>
          {track.artist} · {track.plays} {textFor(t, 'plays', '播放')}
        </span>
      </div>
      <span>{track.duration}</span>
    </div>
  )
}

function TasksPage({
  t,
  tasks,
  setPage,
  openProfile,
  claimTask,
  submitTask,
  selectedTask,
  setSelectedTask,
  simulateAction,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  claimTask: (task: Task) => void
  submitTask: (task: Task) => void
  selectedTask: Task
  setSelectedTask: (task: Task) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const scopedTasks = localizedTasks(tasks, t)
  const categories = ['All', 'Music', 'Image', 'Video', 'Voice', 'Prompt', 'Design', 'Automation']
  const [activeCategory, setActiveCategory] = useState('All')
  const openTaskCount = scopedTasks.filter((task) => task.status === 'Open').length
  const activeMakerCount = rankProfiles('maker').length
  const completedValue = isZh ? '¥120万' : '$120K'
  const visibleTasks =
    activeCategory === 'All'
      ? scopedTasks
      : scopedTasks.filter((task) => task.category === activeCategory || (activeCategory === 'Design' && task.category === 'Image'))
  const activeSelectedTask =
    visibleTasks.find((task) => task.id === selectedTask.id) ?? scopedTasks.find((task) => task.id === selectedTask.id) ?? scopedTasks[0] ?? selectedTask
  const publisherProfile = findProfile(activeSelectedTask.publisher)
  const assigneeProfile = activeSelectedTask.assignee === 'Unassigned' ? undefined : findProfile(activeSelectedTask.assignee)

  const selectCategory = (category: string) => {
    const matches =
      category === 'All'
        ? scopedTasks
        : scopedTasks.filter((task) => task.category === category || (category === 'Design' && task.category === 'Image'))
    setActiveCategory(category)
    const firstMatch = matches[0]
    if (firstMatch) {
      setSelectedTask(firstMatch)
    }
    simulateAction(
      isZh
        ? `已切换任务分类：${categoryLabel(category, t)}，当前显示 ${matches.length} 条结果`
        : `Task category changed to ${category}. Showing ${matches.length} results.`,
    )
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Marketplace', '任务市场')}
        title={t.tasksTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('publish')}>
            <Plus size={17} />
            {t.postTask}
          </button>
        }
      />
      <div className="market-dashboard">
        {[
          [textFor(t, 'Open tasks', '开放任务'), `${openTaskCount}`, textFor(t, 'Music, image, video, voice, automation', '音乐、图片、视频、配音、自动化')],
          [textFor(t, 'Active makers', '活跃创作者'), `${activeMakerCount}`, textFor(t, 'Available for scoped AI work', '可接取明确范围的 AI 工作')],
          [textFor(t, 'Avg. response', '平均响应'), '18m', textFor(t, 'Fast proposals and discussion', '快速提案与讨论')],
          [textFor(t, 'Completed value', '已完成金额'), completedValue, textFor(t, 'Simulated marketplace volume', '前端模拟市场规模')],
        ].map(([label, value, text]) => (
          <article className="metric-card highlight" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{text}</small>
          </article>
        ))}
      </div>
      <div className="tasks-workspace">
        <div className="tasks-main">
          <section className="task-publish-strip">
            <div>
              <span className="eyebrow">{textFor(t, 'Request builder', '需求构建器')}</span>
              <h3>{textFor(t, 'Post an AI requirement with budget, deadline, category, attachments, and delivery rules.', '发布包含预算、周期、分类、附件和交付规则的 AI 需求。')}</h3>
            </div>
            <div className="publish-fields">
              <span>{textFor(t, 'Title', '标题')}</span>
              <span>{textFor(t, 'Budget', '预算')}</span>
              <span>{textFor(t, 'Deadline', '周期')}</span>
              <span>{textFor(t, 'Category', '分类')}</span>
            </div>
            <button className="primary-button" type="button" onClick={() => setPage('publish')}>
              <PenLine size={17} />
              {textFor(t, 'Start brief', '开始发布')}
            </button>
          </section>
          <div className="chip-row">
            {categories.map((category) => (
              <button
                className={activeCategory === category ? 'chip active' : 'chip'}
                type="button"
                key={category}
                onClick={() => selectCategory(category)}
              >
                {categoryLabel(category, t)}
              </button>
            ))}
          </div>
          <div className="content-grid task-layout">
            <div className="task-list">
              {visibleTasks.map((task) => (
                <button
                  className={activeSelectedTask.id === task.id ? 'task-card active' : 'task-card'}
                  type="button"
                  key={task.id}
                  onClick={() => {
                    setSelectedTask(task)
                    simulateAction(isZh ? `已打开任务详情：${task.title}` : `Opened task detail: ${task.title}`)
                  }}
                >
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {categoryLabel(task.category, t)} · {task.deadline}
                    </span>
                    <span>{task.points} · @{task.publisher}</span>
                  </div>
                  <div>
                    <b>{task.budget}</b>
                    <StatusBadge status={task.status} t={t} />
                  </div>
                </button>
              ))}
              {visibleTasks.length === 0 && (
                <div className="empty-state">
                  <strong>{textFor(t, 'No tasks in this category', '当前分类暂无任务')}</strong>
                  <span>{textFor(t, 'Publish a simulated task or switch to another category.', '可以发布一个中文模拟任务，或切换到其他分类继续测试。')}</span>
                </div>
              )}
            </div>
            <article className="panel task-detail">
              <div className="detail-top">
                <StatusBadge status={activeSelectedTask.status} t={t} />
                <span>{activeSelectedTask.proposals} {textFor(t, 'proposals', '个提案')}</span>
              </div>
              <h2>{activeSelectedTask.title}</h2>
              <p>{activeSelectedTask.description}</p>
              <div className="detail-stats">
                <span>
                  <CircleDollarSign size={17} />
                  {activeSelectedTask.budget}
                </span>
                <span>
                  <BadgeDollarSign size={17} />
                  {activeSelectedTask.points}
                </span>
                <span>
                  <Clock3 size={17} />
                  {activeSelectedTask.deadline}
                </span>
                <span>
                  <UsersRound size={17} />
                  {activeSelectedTask.proposals} {textFor(t, 'makers', '位创作者')}
                </span>
              </div>
              <div className="split-row">
                <span>
                  {textFor(t, 'Publisher', '发布方')}:{' '}
                  {publisherProfile ? (
                    <button className="profile-link" type="button" onClick={() => openProfile(publisherProfile)}>
                      @{activeSelectedTask.publisher}
                    </button>
                  ) : (
                    <>@{activeSelectedTask.publisher}</>
                  )}
                </span>
                <span>
                  {textFor(t, 'Assignee', '接单方')}:{' '}
                  {assigneeProfile ? (
                    <button className="profile-link" type="button" onClick={() => openProfile(assigneeProfile)}>
                      @{activeSelectedTask.assignee}
                    </button>
                  ) : (
                    <>@{activeSelectedTask.assignee === 'Unassigned' ? textFor(t, 'Unassigned', '待接单') : activeSelectedTask.assignee}</>
                  )}
                </span>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={() => claimTask(activeSelectedTask)}>
                  <BriefcaseBusiness size={17} />
                  {t.takeTask}
                </button>
                <button className="ghost-button" type="button" onClick={() => submitTask(activeSelectedTask)}>
                  <Upload size={17} />
                  {t.submitWork}
                </button>
              </div>
              <div className="timeline">
                {['Open', 'In Progress', 'Pending Review', 'Completed'].map((step) => (
                  <span className={activeSelectedTask.status === step ? 'active' : ''} key={step}>
                    {statusLabel(step, t)}
                  </span>
                ))}
              </div>
              <div className="detail-section-grid">
                <InfoBox title={textFor(t, 'Submission requirements', '提交要求')} items={activeSelectedTask.requirements} />
                <InfoBox title={textFor(t, 'Attachments', '附件')} items={activeSelectedTask.attachments} />
                <InfoBox title={textFor(t, 'Private brief', '私密说明')} text={activeSelectedTask.privateBrief} />
                <InfoBox title={textFor(t, 'Submitted result', '已提交成果')} text={activeSelectedTask.submission} items={activeSelectedTask.resultLinks} />
                <InfoBox title={textFor(t, 'Review note', '验收备注')} text={activeSelectedTask.reviewNote} />
                <InfoBox title={textFor(t, 'Rights', '版权范围')} text={activeSelectedTask.rights} />
              </div>
            </article>
          </div>
        </div>
        <aside className="tasks-sidebar">
          <div className="leaderboard-grid">
            <LeaderboardPanel
              t={t}
              lane="maker"
              title={textFor(t, 'Taker ranking', '接单排行榜')}
              subtitle={textFor(t, 'Best matched makers by delivery score', '按交付分、通过率和响应速度排序')}
              profiles={rankProfiles('maker').slice(0, 5)}
              openProfile={openProfile}
            />
            <LeaderboardPanel
              t={t}
              lane="publisher"
              title={textFor(t, 'Publisher ranking', '发需求排行榜')}
              subtitle={textFor(t, 'Publishers with clear briefs and fast acceptance', '按需求清晰度、发布量和验收速度排序')}
              profiles={rankProfiles('publisher').slice(0, 5)}
              openProfile={openProfile}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

function StatusBadge({ status, t }: { status: string; t?: Record<string, string> }) {
  return <span className={`status-badge ${status.toLowerCase().replace(/\s/g, '-')}`}>{statusLabel(status, t)}</span>
}

function InfoBox({ title, text, items }: { title: string; text?: string; items?: string[] }) {
  return (
    <div className="deliverable-box">
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {items && (
        <ul className="clean-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LeaderboardPanel({
  t,
  lane,
  title,
  subtitle,
  profiles,
  openProfile,
}: {
  t: Record<string, string>
  lane: 'maker' | 'publisher'
  title: string
  subtitle: string
  profiles: MarketplaceProfile[]
  openProfile: (profile: MarketplaceProfile) => void
}) {
  const isZh = isZhCopy(t)
  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-head">
        <div>
          <span className="eyebrow">{lane === 'maker' ? textFor(t, 'Makers', '接单者') : textFor(t, 'Publishers', '发布者')}</span>
          <strong>{title}</strong>
        </div>
        <span>{subtitle}</span>
      </div>
      <div className="rank-list">
        {profiles.map((profile, index) => (
          <button className="rank-row" type="button" key={profile.id} onClick={() => openProfile(profile)}>
            <b>#{index + 1}</b>
            <span className="avatar compact">{profile.initials}</span>
            <span className="rank-copy">
              <strong>{localizeText(profile.name, t)}</strong>
              <small>@{profile.handle} · {profileTags(profile, t).slice(0, 2).join(' / ')}</small>
            </span>
            <span className="rank-metric">
              <strong>{lane === 'maker' ? profile.stats.completed : profile.stats.posted}</strong>
              <small>{lane === 'maker' ? (isZh ? '完成' : 'done') : isZh ? '发布' : 'posted'}</small>
            </span>
            <span className="rank-metric">
              <strong>{lane === 'maker' ? profile.stats.acceptance : profile.stats.response}</strong>
              <small>{lane === 'maker' ? (isZh ? '通过率' : 'accept') : isZh ? '响应' : 'response'}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function EnginePage({
  t,
  setPage,
  simulateAction,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const defaultEngineLines = isZh
    ? [
        '范围：30 秒中文课程宣传短视频',
        '交付物：中文脚本、字幕 SRT、AI 配音建议、封面提示词、MP4 成片',
        '预估奖励：¥2,400-¥3,200 / 2,400-3,200 积分',
        '验收路径：脚本确认 -> 首版预览 -> 一轮修改 -> 验收放款',
      ]
    : [
        'Scope: 30s vertical launch video',
        'Deliverables: MP4, captions, music cue, prompt notes',
        'Estimated reward: $420-$520 / 4,200-5,200 pts',
        'Review path: first preview -> revision -> acceptance',
      ]
  const matches = isZh
    ? [
        ['短视频剪辑师', '96%', '擅长中文字幕、产品卖点和社媒竖版导出'],
        ['提示词系统设计师', '88%', '可复用提示词包、验收清单和任务模板'],
        ['AI 配音专员', '84%', '旁白清理、声音匹配和前后对比说明'],
      ]
    : engineMatches
  const [analysisRun, setAnalysisRun] = useState(1)
  const [engineLines, setEngineLines] = useState(defaultEngineLines)

  const analyzeRequest = () => {
    setAnalysisRun((current) => current + 1)
    setEngineLines(
      isZh
        ? [
            `范围：中文课程短视频第 ${analysisRun + 1} 版需求拆解`,
            '交付物：中文脚本、字幕 SRT、AI 配音建议、封面提示词、MP4 成片',
            '预估奖励：¥2,400-¥3,200 / 2,400-3,200 积分',
            '验收路径：脚本确认 -> 首版预览 -> 一轮修改 -> 验收放款',
          ]
        : [
            `Scope: product launch video analysis run ${analysisRun + 1}`,
            'Deliverables: MP4, captions, music cue, prompt notes, review summary',
            'Estimated reward: $420-$520 / 4,200-5,200 pts',
            'Review path: script approval -> first preview -> revision -> acceptance',
          ],
    )
    simulateAction(isZh ? 'AI 任务引擎已完成一次中文需求拆解' : 'AI task engine completed one request analysis')
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Smart workflow', '智能工作流')}
        title={t.engineTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('publish')}>
            <PenLine size={17} />
            {textFor(t, 'Create draft', '生成草稿')}
          </button>
        }
      />
      <section className="engine-hero panel">
        <div>
          <span className="pill">
            <Bot size={16} />
            {textFor(t, 'Requirement splitter', '需求拆解器')}
          </span>
          <h2>{t.engineSubtitle}</h2>
          <textarea
            defaultValue={textFor(
              t,
              'I need a polished AI product launch video with captions, generated music, and reusable prompt notes for future campaigns.',
              '我需要一套中文课程宣传短视频，包含字幕、AI 配音、封面提示词和可复用交付说明。',
            )}
          />
          <div className="button-row">
            <button className="primary-button" type="button" onClick={analyzeRequest}>
              <Sparkles size={17} />
              {textFor(t, 'Analyze request', '分析需求')}
            </button>
            <button className="ghost-button" type="button" onClick={() => setPage('tasks')}>
              <BriefcaseBusiness size={17} />
              {textFor(t, 'Browse matches', '浏览匹配任务')}
            </button>
          </div>
        </div>
        <div className="engine-output">
          {engineLines.map((line) => (
            <span key={line}>
              <Check size={15} />
              {line}
            </span>
          ))}
        </div>
      </section>
      <div className="content-grid">
        <section className="panel">
          <SectionHeader eyebrow={textFor(t, 'Smart matching', '智能匹配')} title={textFor(t, 'Recommended makers', '推荐创作者')} />
          <div className="table-list">
            {matches.map(([role, score, text]) => (
              <div className="table-row" key={role}>
                <strong>{role}</strong>
                <span>{score}</span>
                <small>{text}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <SectionHeader eyebrow={textFor(t, 'Contribution proof', '贡献证明')} title={textFor(t, 'Task history signal', '任务履历信号')} />
          <div className="proof-list">
            {localizedTasks(tasks, t).slice(1, 4).map((task) => (
              <div className="proof-item" key={task.id}>
                <StatusBadge status={task.status} t={t} />
                <strong>{task.title}</strong>
                <span>
                  @{task.assignee} · {task.points}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function PublishPage({
  t,
  setPage,
  requireAuth,
  publishTask,
  openProfile,
  simulateAction,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  requireAuth: () => void
  publishTask: (draft: PublishDraft) => void
  openProfile: (profile: MarketplaceProfile) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [draft, setDraft] = useState<PublishDraft>({
    title: textFor(t, 'Create a 30-second AI product launch video', '制作一套中文 AI 课程宣传短视频'),
    category: 'Video',
    reward: textFor(t, '$450 / 4,500 pts', '¥2,800 / 2,800 积分'),
    deadline: textFor(t, '3 days', '4 天'),
    visibility: 'Public brief + private files',
    details: textFor(
      t,
      'Need a polished vertical video with product shots, captions, music, and fast edits.',
      '需要 3 条中文竖版短视频，包含课程卖点、字幕、AI 配音和封面建议。',
    ),
    rules: textFor(
      t,
      'Submit script, preview link, final MP4, captions, cover prompt, and rights summary.',
      '提交脚本、预览链接、最终 MP4、字幕文件、封面提示词和版权摘要。',
    ),
  })

  const updateDraft = (key: keyof PublishDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const recommendedProfiles = useMemo(() => matchProfilesForDraft(draft), [draft])

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Request form', '需求表单')}
        title={t.publishTitle}
        action={
          <button className="ghost-button" type="button" onClick={() => setPage('engine')}>
            <Bot size={17} />
            {textFor(t, 'Use engine', '使用引擎')}
          </button>
        }
      />
      <section className="form-layout">
        <div className="panel form-panel">
          <label>
            {textFor(t, 'Task title', '任务标题')}
            <input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              {textFor(t, 'Category', '分类')}
              <select value={draft.category} onChange={(event) => updateDraft('category', event.target.value)}>
                {['Music', 'Image', 'Video', 'Voice', 'Prompt', 'Automation'].map((item) => (
                  <option key={item} value={item}>{categoryLabel(item, t)}</option>
                ))}
              </select>
            </label>
            <label>
              {textFor(t, 'Reward', '奖励')}
              <input value={draft.reward} onChange={(event) => updateDraft('reward', event.target.value)} />
            </label>
            <label>
              {textFor(t, 'Deadline', '截止时间')}
              <input value={draft.deadline} onChange={(event) => updateDraft('deadline', event.target.value)} />
            </label>
            <label>
              {textFor(t, 'Visibility', '可见范围')}
              <select value={draft.visibility} onChange={(event) => updateDraft('visibility', event.target.value)}>
                <option value="Public brief + private files">{textFor(t, 'Public brief + private files', '公开需求 + 私密附件')}</option>
                <option value="Private invite only">{textFor(t, 'Private invite only', '仅私密邀请')}</option>
                <option value="Community visible">{textFor(t, 'Community visible', '社区可见')}</option>
              </select>
            </label>
          </div>
          <label>
            {textFor(t, 'Requirement details', '需求详情')}
            <textarea value={draft.details} onChange={(event) => updateDraft('details', event.target.value)} />
          </label>
          <label>
            {textFor(t, 'Submission and acceptance rules', '提交与验收规则')}
            <textarea value={draft.rules} onChange={(event) => updateDraft('rules', event.target.value)} />
          </label>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => publishTask(draft)}>
              <Upload size={17} />
              {textFor(t, 'Publish task', '发布任务')}
            </button>
            <button className="ghost-button" type="button" onClick={requireAuth}>
              <FileText size={17} />
              {textFor(t, 'Save draft', '保存草稿')}
            </button>
          </div>
        </div>
        <aside className="side-stack">
          <section className="panel side-panel compact-panel">
            <SectionHeader eyebrow={textFor(t, 'Auto checks', '自动检查')} title={textFor(t, 'Ready to publish', '可以发布')} />
          {(isZh
            ? ['标题清晰', '预算和积分已填写', '包含验收标准', '附件已标记私密', '已开启社区讨论']
            : ['Clear title', 'Budget and points set', 'Acceptance criteria included', 'Attachments marked private', 'Community discussion enabled']
          ).map((item) => (
            <div className="check-line" key={item}>
              <Check size={16} />
              <span>{item}</span>
            </div>
          ))}
          <button className="ghost-button" type="button" onClick={() => setPage('community')}>
            <MessageCircle size={17} />
            {textFor(t, 'Discuss in community', '到社区讨论')}
          </button>
          </section>
          <section className="panel match-panel">
            <SectionHeader
              eyebrow={textFor(t, 'Smart matching', '智能匹配')}
              title={textFor(t, 'Recommended makers', '推荐接单用户')}
            />
            <div className="match-list">
              {recommendedProfiles.map(({ profile, score, tags, categoryHit, languageHit }) => {
                const visibleTags = tags.length ? tags : profileTags(profile, t).slice(0, 2)
                return (
                  <article className="match-card" key={profile.id}>
                    <div className="match-card-top">
                      <span className="avatar compact">{profile.initials}</span>
                      <div>
                        <strong>{localizeText(profile.name, t)}</strong>
                        <span>@{profile.handle} · {localizeText(profile.role, t)}</span>
                      </div>
                      <b>{score}%</b>
                    </div>
                    <p>
                      {categoryHit
                        ? textFor(t, 'Category match', '分类匹配')
                        : textFor(t, 'Related skill match', '相关能力匹配')}
                      {languageHit ? ` · ${textFor(t, 'Chinese ready', '支持中文')}` : ''}
                      {' · '}
                      {textFor(t, 'Response', '响应')} {profile.stats.response}
                    </p>
                    <div className="skill-cloud compact">
                      {visibleTags.map((tag) => (
                        <span className="tag" key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="button-row compact-buttons">
                      <button className="ghost-button" type="button" onClick={() => openProfile(profile)}>
                        <UserRound size={16} />
                        {textFor(t, 'Profile', '主页')}
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() =>
                          simulateAction(
                            isZh
                              ? `已邀请 @${profile.handle} 查看需求：${draft.title}`
                              : `Invited @${profile.handle} to review: ${draft.title}`,
                            { description: `Invited maker: @${profile.handle}`, delta: '+2' },
                          )
                        }
                      >
                        <Send size={16} />
                        {textFor(t, 'Invite', '邀请')}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </aside>
      </section>
    </div>
  )
}

function MyTasksPage({
  t,
  tasks,
  setPage,
  submitTask,
  simulateAction,
}: {
  t: Record<string, string>
  tasks: Task[]
  setPage: (page: Page) => void
  submitTask: (task: Task) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const activeTasks = localizedTasks(tasks, t).filter((task) => task.assignee !== 'Unassigned')
  const [selectedMineId, setSelectedMineId] = useState<number | undefined>(activeTasks[0]?.id ?? tasks[0]?.id)
  const primaryTask = activeTasks.find((task) => task.id === selectedMineId) ?? activeTasks[0] ?? tasks[0]
  const stages = isZh
    ? [
        { label: '已接取', value: '3', text: '需要首版预览或补充确认的任务。' },
        { label: '已提交', value: '2', text: '等待发布方或管理员验收。' },
        { label: '已完成', value: '14', text: '已验收成果会进入贡献履历。' },
      ]
    : myTaskStages

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Delivery desk', '交付工作台')}
        title={t.mineTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('tasks')}>
            <BriefcaseBusiness size={17} />
            {textFor(t, 'Find tasks', '寻找任务')}
          </button>
        }
      />
      <div className="market-dashboard">
        {stages.map((stage) => (
          <article className="metric-card highlight" key={stage.label}>
            <span>{stage.label}</span>
            <strong>{stage.value}</strong>
            <small>{stage.text}</small>
          </article>
        ))}
        <article className="metric-card highlight">
          <span>{textFor(t, 'Points pending', '待结算积分')}</span>
          <strong>4,100</strong>
          <small>{textFor(t, 'Released after publisher acceptance.', '发布方验收后发放。')}</small>
        </article>
      </div>
      <div className="content-grid task-layout">
        <div className="task-list">
          {activeTasks.map((task) => (
            <button
              className={primaryTask.id === task.id ? 'task-card active' : 'task-card'}
              type="button"
              key={task.id}
              onClick={() => {
                setSelectedMineId(task.id)
                simulateAction(`已选择我的任务：${task.title}`)
              }}
            >
              <div>
                <strong>{task.title}</strong>
                <span>
                  @{task.publisher} · {task.deadline}
                </span>
                <span>{task.reviewNote}</span>
              </div>
              <div>
                <b>{task.points}</b>
                <StatusBadge status={task.status} t={t} />
              </div>
            </button>
          ))}
          {activeTasks.length === 0 && (
            <div className="empty-state">
              <strong>{textFor(t, 'No claimed tasks yet', '还没有接取任务')}</strong>
              <span>{textFor(t, 'Claim a task from the plaza to see delivery workflow here.', '去任务广场接取一个中文模拟需求后，这里会显示交付流程。')}</span>
            </div>
          )}
        </div>
        <article className="panel task-detail">
          <span className="eyebrow">{textFor(t, 'Submit deliverable', '提交交付物')}</span>
          <h2>{textFor(t, 'Delivery package', '交付包')}</h2>
          <p>{textFor(t, 'Attach preview links, final files, prompt recipes, revision notes, and rights summary before requesting review.', '申请验收前，请附上预览链接、最终文件、提示词配方、修改说明和版权摘要。')}</p>
          <div className="form-panel inline-form">
            <label>
              {textFor(t, 'Result links', '成果链接')}
              <input defaultValue={textFor(t, 'drive/final-pack, figma/preview-board, loom/walkthrough', '网盘/最终交付包，飞书/预览板，录屏/讲解')} />
            </label>
            <label>
              {textFor(t, 'Delivery note', '交付说明')}
              <textarea defaultValue={textFor(t, 'Included final export, editable prompts, revision summary, and commercial usage note.', '已包含最终导出、可编辑提示词、修改摘要和商用范围说明。')} />
            </label>
          </div>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => submitTask(primaryTask)}>
              <Upload size={17} />
              {textFor(t, 'Request review', '申请验收')}
            </button>
            <button className="ghost-button" type="button" onClick={() => setPage('community')}>
              <MessageCircle size={17} />
              {textFor(t, 'Post recap', '发布复盘')}
            </button>
          </div>
          <InfoBox
            title={textFor(t, 'Contribution history', '贡献记录')}
            items={
              isZh
                ? ['已接取任务', '已提交预览', '已处理修改意见', '等待验收和积分发放']
                : ['Claimed task', 'Submitted preview', 'Resolved revision note', 'Awaiting acceptance and points release']
            }
          />
        </article>
      </div>
    </div>
  )
}

function InspirationPage({
  t,
  items,
  setPage,
  simulateAction,
}: {
  t: Record<string, string>
  items: InspirationItem[]
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const categories = ['Featured', 'Task templates', 'Prompt packs', 'Tutorials', 'Case studies', 'Good idea radar']
  const categoryLabels: Record<string, string> = {
    Featured: textFor(t, 'Featured', '精选'),
    'Task templates': textFor(t, 'Task templates', '任务模板'),
    'Prompt packs': textFor(t, 'Prompt packs', '提示词包'),
    Tutorials: textFor(t, 'Tutorials', '教程'),
    'Case studies': textFor(t, 'Case studies', '案例复盘'),
    'Good idea radar': textFor(t, 'Good idea radar', '好点子雷达'),
  }
  const [activeCategory, setActiveCategory] = useState('Featured')
  const scopedItems = localizedInspiration(items, t)
  const visibleItems =
    activeCategory === 'Featured'
      ? scopedItems
      : scopedItems.filter((item) => {
          const content = `${item.title} ${item.type} ${item.source} ${item.text}`.toLowerCase()
          if (activeCategory === 'Task templates') return content.includes('template') || content.includes('模板')
          if (activeCategory === 'Prompt packs') return content.includes('prompt') || content.includes('提示词')
          if (activeCategory === 'Tutorials') return content.includes('guide') || content.includes('教程')
          if (activeCategory === 'Case studies') return content.includes('recap') || content.includes('复盘') || content.includes('案例')
          return true
        })

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Knowledge base', '知识库')}
        title={t.inspirationTitle}
        action={
          <button className="primary-button" type="button" onClick={() => setPage('publish')}>
            <Plus size={17} />
            {textFor(t, 'Turn into task', '转成任务')}
          </button>
        }
      />
      <div className="chip-row">
        {categories.map((item) => (
          <button
            className={activeCategory === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveCategory(item)
              simulateAction(isZh ? `已切换灵感分类：${categoryLabels[item]}` : `Inspiration category changed: ${item}`)
            }}
          >
            {categoryLabels[item]}
          </button>
        ))}
      </div>
      <div className="content-grid three">
        {visibleItems.map((item) => (
          <article className="library-card" key={item.title}>
            <span className="pill small">{categoryLabel(item.type, t)}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <div className="split-row">
              <span>{item.source}</span>
              <span>{item.saves} {textFor(t, 'saves', '收藏')}</span>
            </div>
            <div className="button-row">
              <button
                className="ghost-button"
                type="button"
                onClick={() =>
                  simulateAction(isZh ? `已收藏灵感：${item.title}` : `Saved inspiration: ${item.title}`, {
                    description: `Saved inspiration item: ${item.title}`,
                    delta: '+10',
                  })
                }
              >
                <Bookmark size={17} />
                {textFor(t, 'Save', '收藏')}
              </button>
              <button className="ghost-button" type="button" onClick={() => setPage('community')}>
                <MessageCircle size={17} />
                {textFor(t, 'Discuss', '讨论')}
              </button>
            </div>
          </article>
        ))}
        {visibleItems.length === 0 && (
          <div className="empty-state">
            <strong>{textFor(t, 'No matching inspiration', '暂无匹配灵感')}</strong>
            <span>{textFor(t, 'Switch category or save community posts to the library.', '切换分类或从社区帖子收入灵感库后再查看。')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function PointsPage({
  t,
  ledger,
  simulateAction,
}: {
  t: Record<string, string>
  ledger: LedgerEntry[]
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const metrics = isZh
    ? [
        ['余额', '18,420', '可用于任务加权和奖励兑换'],
        ['待结算', '4,100', '等待验收和发布方确认'],
        ['排名', '前 4%', '基于已验收任务和已解决回答'],
        ['本月新增', '+6,840', '任务交付、社区回答、模板入库'],
      ]
    : [
        ['Balance', '18,420', 'Available points for boosts and rewards'],
        ['Pending', '4,100', 'Awaiting review and publisher acceptance'],
        ['Rank', 'Top 4%', 'Based on accepted tasks and solved answers'],
        ['This month', '+6,840', 'Task delivery, community answers, templates'],
      ]
  const rewards = isZh
    ? [
        ['加权任务曝光', '-200'],
        ['解锁专业模板', '-120'],
        ['兑换创作者徽章', '-300'],
      ]
    : [
        ['Boost a task listing', '-200'],
        ['Unlock pro templates', '-120'],
        ['Redeem creator badge', '-300'],
      ]
  const scopedLedger = ledger.filter(([, description]) => matchesLanguage(description, isZh))
  const visibleLedger = scopedLedger.length ? scopedLedger : ledger

  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Rewards', '奖励')} title={t.pointsTitle} />
      <div className="market-dashboard">
        {metrics.map(([label, value, text]) => (
          <article className="metric-card highlight" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{text}</small>
          </article>
        ))}
      </div>
      <section className="panel">
        <SectionHeader eyebrow={textFor(t, 'Ledger', '积分流水')} title={textFor(t, 'Points history', '积分记录')} />
        <div className="ledger-table">
          {visibleLedger.map(([time, desc, delta, balance]) => (
            <div className="ledger-row" key={`${time}-${desc}`}>
              <span>{time}</span>
              <strong>{desc}</strong>
              <b className={delta.startsWith('+') ? 'positive' : 'negative'}>{delta}</b>
              <span>{balance}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="content-grid three">
        {rewards.map(([item, cost]) => (
          <article className="library-card" key={item}>
            <Trophy size={22} />
            <h3>{item}</h3>
            <p>{textFor(t, 'Use points earned from accepted work, helpful posts, and featured library contributions.', '使用任务验收、优质帖子和精选灵感贡献获得的积分。')}</p>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                simulateAction(isZh ? `已兑换：${item}` : `Redeemed: ${item}`, {
                  description: `Redeemed reward: ${item}`,
                  delta: cost,
                })
              }
            >
              {textFor(t, 'Redeem', '兑换')}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

function AdminPage({
  t,
  selectedTask,
  setPage,
  approveTask,
  rejectTask,
  simulateAction,
}: {
  t: Record<string, string>
  selectedTask: Task
  setPage: (page: Page) => void
  approveTask: (task: Task) => void
  rejectTask: (task: Task) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const adminTabs = ['Task review', 'Submissions', 'Community', 'Users', 'Tags', 'AI config']
  const adminTabLabels: Record<string, string> = {
    'Task review': textFor(t, 'Task review', '任务审核'),
    Submissions: textFor(t, 'Submissions', '交付物'),
    Community: textFor(t, 'Community', '社区'),
    Users: textFor(t, 'Users', '用户'),
    Tags: textFor(t, 'Tags', '标签'),
    'AI config': textFor(t, 'AI config', 'AI 配置'),
  }
  const queueItems = isZh
    ? [
        ['Pending review', '音乐提示词包', 'soundforge', '验收后发放 1,200 积分'],
        ['Resubmission', '电商图片广告工作流', 'shopstudio', '已驳回一次，需要补充品类样例'],
        ['Community report', 'AI 任务定价讨论帖', 'n8than', '可考虑精选到灵感库'],
        ['Publish audit', '产品发布视频需求', 'launchteam', '检查私密附件权限'],
      ]
    : adminQueues
  const [activeTab, setActiveTab] = useState('Task review')

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Operations', '运营')}
        title={t.adminTitle}
        action={
          <button className="ghost-button" type="button" onClick={() => setPage('points')}>
            <Trophy size={17} />
            {textFor(t, 'Points ledger', '积分流水')}
          </button>
        }
      />
      <div className="chip-row">
        {adminTabs.map((item) => (
          <button
            className={activeTab === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveTab(item)
              simulateAction(isZh ? `管理中心已切换：${adminTabLabels[item]}` : `Admin tab changed: ${item}`)
            }}
          >
            {adminTabLabels[item]}
          </button>
        ))}
      </div>
      <section className="panel">
        <SectionHeader eyebrow={textFor(t, 'Queue', '队列')} title={textFor(t, 'Review and moderation', '审核与治理')} />
        <div className="admin-table">
          {queueItems.map(([status, title, owner, note]) => (
            <div className="admin-row" key={`${status}-${title}`}>
              <StatusBadge status={status} t={t} />
              <strong>{title}</strong>
              <span>@{owner}</span>
              <small>{note}</small>
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={() => rejectTask(selectedTask)}>
                  {textFor(t, 'Reject', '驳回')}
                </button>
                <button className="primary-button" type="button" onClick={() => approveTask(selectedTask)}>
                  {textFor(t, 'Approve', '通过')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function CommunityPage({
  t,
  posts,
  createPost,
  convertPostToTask,
  savePostToLibrary,
  likePost,
  replyToPost,
  openProfile,
  selectedPost,
  setSelectedPost,
  communityFilter,
  setCommunityFilter,
  simulateAction,
}: {
  t: Record<string, string>
  posts: Post[]
  createPost: (draft?: CommunityDraft) => void
  convertPostToTask: (post: Post) => void
  savePostToLibrary: (post: Post) => void
  likePost: (post: Post) => void
  replyToPost: (post: Post, replyText?: string) => void
  openProfile: (profile: MarketplaceProfile) => void
  selectedPost: Post
  setSelectedPost: (post: Post) => void
  communityFilter: string
  setCommunityFilter: (filter: string) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const scopedPosts = localizedPosts(posts, t)
  const templates = ['Question', 'Experience', 'Showcase', 'Task recap']
  const templateLabels: Record<string, string> = {
    Question: textFor(t, 'Question', '提问'),
    Experience: textFor(t, 'Experience', '经验'),
    Showcase: textFor(t, 'Showcase', '作品'),
    'Task recap': textFor(t, 'Task recap', '任务复盘'),
  }
  const [activeTemplate, setActiveTemplate] = useState('Question')
  const [postDraft, setPostDraft] = useState<CommunityDraft>({
    title: textFor(t, 'Question: what should I add to my AI task acceptance criteria?', '中文提问：我的 AI 任务验收标准还缺什么？'),
    category: 'Questions',
    excerpt: textFor(
      t,
      'I am about to publish a product video task and want to confirm deliverables, revision rounds, rights, and review rules.',
      '我准备发布一个中文 AI 课程短视频任务，想确认交付物、修改轮次、版权范围和验收方式是否写清楚。',
    ),
  })
  const [replyDraft, setReplyDraft] = useState(
    textFor(
      t,
      'I would split acceptance into script approval, first preview, revision log, and final files, each with pass criteria.',
      '建议把验收拆成脚本确认、首版预览、修改记录和最终文件四步，并明确每一步的通过标准。',
    ),
  )
  const [localReplies, setLocalReplies] = useState<Record<number, Array<{ author: string; text: string }>>>({})
  const [topicPage, setTopicPage] = useState(1)
  const [communityView, setCommunityView] = useState<'list' | 'detail'>('list')
  const activeSelectedPost =
    scopedPosts.find((post) => post.id === selectedPost.id) ?? scopedPosts[0] ?? selectedPost
  const filteredPosts = scopedPosts.filter((post) => {
    if (communityFilter === 'Hot') return post.votes >= 80 || post.tag === 'Hot' || post.tag === 'Featured'
    if (communityFilter === 'Latest') return true
    if (communityFilter === 'Active') return post.replies >= 10
    if (communityFilter === 'Unanswered') return post.replies === 0 || !post.solved
    if (communityFilter === 'Featured') return post.tag === 'Featured' || post.solved
    if (communityFilter === 'Showcase') return post.category === 'Showcase'
    if (communityFilter === 'Prompts') return post.category === 'Prompts'
    if (communityFilter === 'Tutorials') return post.excerpt.includes('教程') || post.title.toLowerCase().includes('tutorial')
    if (communityFilter === 'Questions') return post.category === 'Questions' || post.category === '提问'
    if (communityFilter === 'Collaboration') return post.excerpt.toLowerCase().includes('collabor') || post.excerpt.includes('协作')
    return true
  })
  const topicsPerPage = 5
  const totalTopicPages = Math.max(1, Math.ceil(filteredPosts.length / topicsPerPage))
  const safeTopicPage = Math.min(topicPage, totalTopicPages)
  const visibleTopics = filteredPosts.slice((safeTopicPage - 1) * topicsPerPage, safeTopicPage * topicsPerPage)
  const topicPages = Array.from({ length: totalTopicPages }, (_, index) => index + 1)
  const filterOptions = [
    ['Hot', isZh ? '热门' : 'Hot'],
    ['Latest', isZh ? '最新' : 'Latest'],
    ['Active', isZh ? '活跃' : 'Active'],
    ['Unanswered', isZh ? '未回复' : 'Unanswered'],
    ['Featured', isZh ? '精选' : 'Featured'],
    ['Showcase', isZh ? '作品' : 'Showcase'],
    ['Prompts', isZh ? '提示词' : 'Prompts'],
    ['Tutorials', isZh ? '教程' : 'Tutorials'],
    ['Questions', isZh ? '问答' : 'Questions'],
    ['Collaboration', isZh ? '协作' : 'Collaboration'],
  ]
  const filterLabel = (filter: string) => filterOptions.find(([key]) => key === filter)?.[1] ?? filter
  const hotPosts = [...scopedPosts].sort((a, b) => b.votes - a.votes).slice(0, 5)
  const sidebarTags = [
    ['Latest', isZh ? '全部话题' : 'All topics', scopedPosts.length],
    ['Questions', isZh ? '问答求助' : 'Q&A', scopedPosts.filter((post) => post.category === 'Questions' || post.category === '提问').length],
    ['Tutorials', isZh ? '教程复盘' : 'Tutorials', scopedPosts.filter((post) => post.category === 'Tutorials').length],
    ['Showcase', isZh ? '作品展示' : 'Showcase', scopedPosts.filter((post) => post.category === 'Showcase').length],
    ['Collaboration', isZh ? '协作招募' : 'Collaboration', scopedPosts.filter((post) => post.category === 'Collaboration').length],
  ] as const

  const chooseFilter = (filter: string) => {
    setCommunityFilter(filter)
    setTopicPage(1)
    const matches = scopedPosts.filter((post) => {
      if (filter === 'Hot') return post.votes >= 80 || post.tag === 'Hot' || post.tag === 'Featured'
      if (filter === 'Latest') return true
      if (filter === 'Active') return post.replies >= 10
      if (filter === 'Unanswered') return post.replies === 0 || !post.solved
      if (filter === 'Featured') return post.tag === 'Featured' || post.solved
      if (filter === 'Showcase') return post.category === 'Showcase'
      if (filter === 'Prompts') return post.category === 'Prompts'
      if (filter === 'Tutorials') return post.excerpt.includes('教程') || post.title.toLowerCase().includes('tutorial')
      if (filter === 'Questions') return post.category === 'Questions' || post.category === '提问'
      if (filter === 'Collaboration') return post.excerpt.toLowerCase().includes('collabor') || post.excerpt.includes('协作')
      return true
    })
    if (matches[0]) {
      setSelectedPost(matches[0])
    }
    setCommunityView('list')
    simulateAction(isZh ? `已切换社区筛选：${filterLabel(filter)}，匹配 ${matches.length} 个帖子` : `Community filter changed: ${filter}. ${matches.length} topics matched.`)
  }

  const goToTopicPage = (page: number) => {
    const target = Math.min(totalTopicPages, Math.max(1, page))
    setTopicPage(target)
    const firstTopic = filteredPosts.slice((target - 1) * topicsPerPage, target * topicsPerPage)[0]
    if (firstTopic) {
      setSelectedPost(firstTopic)
    }
    setCommunityView('list')
    simulateAction(isZh ? `已切换到话题列表第 ${target} 页` : `Topic list changed to page ${target}`)
  }

  const showTopicDetail = (post: Post) => {
    setSelectedPost(post)
    setCommunityView('detail')
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const openAuthorProfile = (author: string) => {
    const profile = findProfile(author)
    if (profile) {
      openProfile(profile)
      return
    }
    simulateAction(isZh ? `暂无 @${author} 的公开主页资料` : `No public profile mock is available for @${author}`)
  }

  const backToTopicList = () => {
    setCommunityView('list')
    requestAnimationFrame(() => document.querySelector('.forum-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const templateCategory = (template: string) => {
    if (template === 'Question') return 'Questions'
    if (template === 'Experience') return 'Tutorials'
    if (template === 'Showcase') return 'Showcase'
    return 'Task Recap'
  }

  const updatePostDraft = (key: keyof CommunityDraft, value: string) => {
    setPostDraft((current) => ({ ...current, [key]: value }))
  }

  const submitPost = () => {
    const draft = {
      title: postDraft.title.trim() || (isZh ? `${templateLabels[activeTemplate]}：中文社区测试帖` : `${templateLabels[activeTemplate]}: front-end forum test topic`),
      category: postDraft.category || templateCategory(activeTemplate),
      excerpt: postDraft.excerpt.trim() || (isZh ? '这是一条用于验证社区发帖流程的中文模拟内容。' : 'This is a front-end mock topic for validating the forum posting flow.'),
    }
    createPost(draft)
    setCommunityFilter('Latest')
    setTopicPage(1)
    setCommunityView('detail')
    setPostDraft({
      title: textFor(t, 'Question: what should I add to my AI task acceptance criteria?', '中文提问：我的 AI 任务验收标准还缺什么？'),
      category: templateCategory(activeTemplate),
      excerpt: textFor(
        t,
        'I am about to publish a product video task and want to confirm deliverables, revision rounds, rights, and review rules.',
        '我准备发布一个中文 AI 课程短视频任务，想确认交付物、修改轮次、版权范围和验收方式是否写清楚。',
      ),
    })
  }

  const submitReply = () => {
    const text = replyDraft.trim()
    if (!text) {
      simulateAction(isZh ? '请先输入回复内容' : 'Please enter a reply first')
      return
    }
    setLocalReplies((current) => ({
      ...current,
      [activeSelectedPost.id]: [...(current[activeSelectedPost.id] ?? []), { author: 'you', text }],
    }))
    replyToPost(activeSelectedPost, text)
    setReplyDraft('')
  }

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={textFor(t, 'Forum', '论坛')}
        title={t.communityTitle}
        action={
          <button className="primary-button" type="button" onClick={submitPost}>
            <PenLine size={17} />
            {t.newPost}
          </button>
        }
      />
      <div className="community-strip">
        {[
          [isZh ? '话题总数' : 'Topics', scopedPosts.length, isZh ? '帖子、问答、复盘' : 'Posts and recaps'],
          [isZh ? '待回复' : 'Unanswered', scopedPosts.filter((post) => post.replies === 0 || !post.solved).length, isZh ? '需要社区处理' : 'Need attention'],
          [isZh ? '可转任务' : 'Task-ready', scopedPosts.filter((post) => post.category === 'Questions' || post.category === 'Task Recap').length, isZh ? '适合发布需求' : 'Ready to scope'],
        ].map(([label, value, hint]) => (
          <article className="community-kpi" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </div>
      <div className="community-layout">
        <section className={communityView === 'detail' ? 'forum-main detail-mode' : 'forum-main'}>
          {communityView === 'list' ? (
            <>
              <div className="topic-toolbar">
                <strong>{isZh ? '全部话题' : 'All topics'}</strong>
                <div className="topic-tabs" aria-label={isZh ? '社区筛选' : 'Community filters'}>
                  {filterOptions.map(([filter, label]) => (
                    <button
                      className={communityFilter === filter ? 'chip active' : 'chip'}
                      type="button"
                      key={filter}
                      onClick={() => chooseFilter(filter)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="topic-table">
                <div className="topic-head">
                  <span>{isZh ? '话题' : 'Topic'}</span>
                  <span>{isZh ? '赞' : 'Votes'}</span>
                  <span>{isZh ? '回复' : 'Replies'}</span>
                  <span>{isZh ? '浏览' : 'Views'}</span>
                  <span>{isZh ? '状态' : 'Status'}</span>
                </div>
                <div className="topic-table-body">
                  {visibleTopics.map((post) => (
                    <article className={activeSelectedPost.id === post.id ? 'topic-row active' : 'topic-row'} key={post.id}>
                      <div className="topic-main">
                        <button
                          className="topic-title-button"
                          type="button"
                          onClick={() => {
                            showTopicDetail(post)
                            simulateAction(isZh ? '已打开社区帖子：' + post.title : 'Opened community topic: ' + post.title)
                          }}
                        >
                          <span className="topic-title-text">{post.title}</span>
                          <span className={post.solved ? 'topic-state solved' : 'topic-state'}>
                            {post.solved ? (isZh ? '已解决' : 'Solved') : isZh ? '讨论中' : 'Open'}
                          </span>
                        </button>
                        <div className="task-meta forum-tags">
                          <span className="tag">{post.tag}</span>
                          <span className="tag">{categoryLabel(post.category, t)}</span>
                        </div>
                        <span className="topic-meta-line">
                          <button className="profile-link topic-author-link" type="button" onClick={() => openAuthorProfile(post.author)}>
                            @{post.author}
                          </button>{' '}
                          / {post.excerpt}
                        </span>
                      </div>
                      <span className="topic-stat">
                        <strong>{post.votes}</strong>
                        {isZh ? '赞' : 'votes'}
                      </span>
                      <span className="topic-stat">
                        <strong>{post.replies}</strong>
                        {isZh ? '回复' : 'replies'}
                      </span>
                      <span className="topic-stat">
                        <strong>{post.views}</strong>
                        {isZh ? '浏览' : 'views'}
                      </span>
                      <span className="topic-stat">{post.solved ? (isZh ? '已解决' : 'Solved') : filterLabel(communityFilter)}</span>
                    </article>
                  ))}
                  {filteredPosts.length === 0 && (
                    <div className="topic-empty">
                      <strong>{isZh ? '当前筛选暂无话题' : 'No topics in this filter'}</strong>
                      <span>{isZh ? '可以在右侧发布一条中文测试话题。' : 'Use the composer on the right to publish a test topic.'}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="topic-pagination">
                <span>
                  {filterLabel(communityFilter)} · {filteredPosts.length ? (safeTopicPage - 1) * topicsPerPage + 1 : 0}-
                  {Math.min(safeTopicPage * topicsPerPage, filteredPosts.length)} / {filteredPosts.length}
                </span>
                <div className="topic-page-numbers" aria-label={isZh ? '话题分页' : 'Topic pages'}>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => goToTopicPage(safeTopicPage - 1)}
                    disabled={safeTopicPage === 1}
                  >
                    {isZh ? '上一页' : 'Prev'}
                  </button>
                  {topicPages.map((pageNumber) => (
                    <button
                      className={safeTopicPage === pageNumber ? 'page-number active' : 'page-number'}
                      type="button"
                      key={pageNumber}
                      onClick={() => goToTopicPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => goToTopicPage(safeTopicPage + 1)}
                    disabled={safeTopicPage === totalTopicPages}
                  >
                    {isZh ? '下一页' : 'Next'}
                  </button>
                </div>
                <span>
                  {isZh ? `第 ${safeTopicPage} / ${totalTopicPages} 页` : `Page ${safeTopicPage} / ${totalTopicPages}`}
                </span>
              </div>
            </>
          ) : (
            <article className="topic-detail post-detail">
              <div className="topic-detail-head">
                <div>
                  <span className="topic-detail-label">
                    <button className="profile-link topic-author-link" type="button" onClick={() => openAuthorProfile(activeSelectedPost.author)}>
                      @{activeSelectedPost.author}
                    </button>{' '}
                    / {categoryLabel(activeSelectedPost.category, t)}
                  </span>
                  <h2>{activeSelectedPost.title}</h2>
                  <div className="task-meta forum-tags">
                    <span className="tag">{activeSelectedPost.tag}</span>
                    <span className="tag">{activeSelectedPost.solved ? (isZh ? '已解决' : 'Solved') : isZh ? '讨论中' : 'Open'}</span>
                  </div>
                </div>
                <button className="chip back-to-list" type="button" onClick={backToTopicList}>
                  {isZh ? '返回列表' : 'Back to list'}
                </button>
              </div>
              <div className="post-body">
                <p>{activeSelectedPost.body ?? activeSelectedPost.excerpt}</p>
                <p>{activeSelectedPost.excerpt}</p>
              </div>
              <div className="topic-detail-metrics">
                <span>
                  <strong>{activeSelectedPost.likes}</strong>
                  {isZh ? '点赞' : 'likes'}
                </span>
                <span>
                  <strong>{activeSelectedPost.replies}</strong>
                  {isZh ? '回复' : 'replies'}
                </span>
                <span>
                  <strong>{activeSelectedPost.views}</strong>
                  {isZh ? '浏览' : 'views'}
                </span>
                <span>
                  <strong>{activeSelectedPost.votes}</strong>
                  {isZh ? '投票' : 'votes'}
                </span>
              </div>
              <div className="embedded-work">
                <img src={visualWorks[1].image} alt="" />
                <div>
                  <strong>{isZh ? '关联作品' : 'Embedded work'}</strong>
                  <span>{isZh ? '帖子可关联图片、视频、音频、提示词和任务编号。' : 'Attach image, video, audio, prompt, and task references.'}</span>
                </div>
              </div>
              <div className="post-action-bar">
                <button className="compact-action" type="button" onClick={() => likePost(activeSelectedPost)} title={isZh ? '点赞' : 'Like'}>
                  <Heart size={17} />
                  <span>{isZh ? '点赞' : 'Like'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => savePostToLibrary(activeSelectedPost)} title={isZh ? '收藏' : 'Save'}>
                  <Bookmark size={17} />
                  <span>{isZh ? '收藏' : 'Save'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => convertPostToTask(activeSelectedPost)} title={isZh ? '转成任务' : 'Turn into task'}>
                  <BriefcaseBusiness size={17} />
                  <span>{isZh ? '任务' : 'Task'}</span>
                </button>
                <button className="compact-action" type="button" onClick={() => savePostToLibrary(activeSelectedPost)} title={isZh ? '收入灵感库' : 'Add to library'}>
                  <Tags size={17} />
                  <span>{isZh ? '入库' : 'Library'}</span>
                </button>
                <button className="compact-action primary" type="button" onClick={submitReply} title={t.reply}>
                  <MessageCircle size={17} />
                  <span>{t.reply}</span>
                </button>
              </div>
              <div className="comment-list">
                <div className="comment-heading">
                  <strong>{isZh ? '回复' : 'Replies'}</strong>
                  <span>
                    {activeSelectedPost.replies + (localReplies[activeSelectedPost.id]?.length ?? 0)} {isZh ? '条' : 'total'}
                  </span>
                </div>
                <Comment author="iriswood" text={isZh ? '建议补一个验收清单：脚本、成片、字幕、封面、版权授权分别确认。' : 'This workflow is clean. I would add a style-lock prompt for the visual loop.'} />
                <Comment author="veyn" text={isZh ? '如果要转任务，可以把修改轮次和最终文件格式写成硬性验收项。' : 'The second prompt version gives much better motion consistency.'} />
                {(localReplies[activeSelectedPost.id] ?? []).map((reply, index) => (
                  <Comment author={reply.author} text={reply.text} key={activeSelectedPost.id + '-' + index + '-' + reply.text} />
                ))}
              </div>
              <div className="reply-box">
                <textarea
                  value={replyDraft}
                  onChange={(event) => setReplyDraft(event.target.value)}
                  placeholder={isZh ? '写回复，或粘贴交付链接、提示词、任务建议...' : 'Write a reply, delivery link, prompt, or task suggestion...'}
                />
                <button className="primary-button" type="button" onClick={submitReply}>
                  {t.reply}
                </button>
              </div>
            </article>
          )}
        </section>
        <aside className="community-sidebar">
          <section className="tag-panel post-composer-panel">
            <div className="panel-title">
              <strong>{isZh ? '发布帖子' : 'Publish topic'}</strong>
              <span>{isZh ? '问题 / 心得 / 作品 / 复盘' : 'Question / note / showcase / recap'}</span>
            </div>
            <div className="quick-template-row">
              {templates.map((item) => (
                <button
                  className={activeTemplate === item ? 'chip active' : 'chip'}
                  type="button"
                  key={item}
                  onClick={() => {
                    setActiveTemplate(item)
                    updatePostDraft('category', templateCategory(item))
                    simulateAction(isZh ? '已选择发帖模板：' + templateLabels[item] : 'Post template selected: ' + item)
                  }}
                >
                  {templateLabels[item]}
                </button>
              ))}
            </div>
            <div className="quick-post-line">
              <UserRound size={18} />
              <input
                value={postDraft.title}
                onChange={(event) => updatePostDraft('title', event.target.value)}
                placeholder={isZh ? '输入帖子标题' : 'Topic title'}
              />
            </div>
            <textarea
              className="quick-post-editor"
              value={postDraft.excerpt}
              onChange={(event) => updatePostDraft('excerpt', event.target.value)}
              placeholder={isZh ? '写下你的问题、经验、作品说明或任务复盘...' : 'Write a question, lesson, showcase, or task recap...'}
            />
            <div className="button-row">
              <button
                className="ghost-button"
                type="button"
                onClick={() =>
                  simulateAction(
                    isZh
                      ? '已为“' + templateLabels[activeTemplate] + '”附加模拟作品：中文课程短视频预览.mp4'
                      : 'Attached demo work to "' + activeTemplate + '": product-video-preview.mp4',
                  )
                }
              >
                <Image size={17} />
                {isZh ? '附件' : 'Attach'}
              </button>
              <button className="primary-button" type="button" onClick={submitPost}>
                <PenLine size={17} />
                {t.newPost}
              </button>
            </div>
          </section>
          <section className="tag-panel">
            <div className="panel-title">
              <strong>{isZh ? '标签' : 'Tags'}</strong>
              <span>{isZh ? '按方向浏览' : 'Browse by lane'}</span>
            </div>
            <div className="tag-list compact">
              {sidebarTags.map(([filter, label, count]) => (
                <button
                  className={communityFilter === filter ? 'tag-item active' : 'tag-item'}
                  type="button"
                  key={filter}
                  onClick={() => chooseFilter(filter)}
                >
                  <strong>{label}</strong>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="tag-panel">
            <div className="panel-title">
              <strong>{isZh ? '热门话题' : 'Hot right now'}</strong>
              <span>{isZh ? '社区正在讨论' : 'Most discussed'}</span>
            </div>
            <div className="hot-list">
              {hotPosts.map((post) => (
                <button
                  className="hot-item"
                  type="button"
                  key={post.id}
                onClick={() => {
                  showTopicDetail(post)
                  simulateAction(isZh ? '已选择热门话题：' + post.title : 'Hot topic selected: ' + post.title)
                }}
                >
                  <strong>{post.title}</strong>
                  <span>
                    {post.views} {isZh ? '浏览' : 'views'} / {post.replies} {isZh ? '回复' : 'replies'}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="tag-panel">
            <div className="panel-title">
              <strong>{isZh ? '社区动作' : 'Forum actions'}</strong>
              <span>{isZh ? '和任务广场联动' : 'Connected to tasks'}</span>
            </div>
            <InfoBox
              title={isZh ? '可测试流程' : 'Testable flows'}
              items={
                isZh
                  ? ['标记有效回复', '讨论转成任务草稿', '精选内容收入灵感库', '优质回复奖励积分']
                  : ['Mark accepted answer', 'Convert discussion to task draft', 'Feature high-value post to Inspiration Library', 'Award points for helpful replies']
              }
            />
          </section>
        </aside>
      </div>
    </div>
  )
}

function PricingPage({
  t,
  billing,
  setBilling,
  requireAuth,
}: {
  t: Record<string, string>
  billing: 'year' | 'month'
  setBilling: (value: 'year' | 'month') => void
  requireAuth: () => void
}) {
  const isZh = isZhCopy(t)
  const plans = isZh
    ? [
        { name: '免费版', price: '¥0', credits: '500 积分', songs: '10 首/月', badge: '' },
        { name: 'Plus', price: '¥68', credits: '60K 积分/年', songs: '100 首/月', badge: '' },
        { name: 'Pro', price: '¥118', credits: '300K 积分/年', songs: '500 首/月', badge: '最受欢迎' },
        { name: 'Ultra', price: '¥228', credits: '不限量', songs: '不限量生成', badge: '' },
      ]
    : planCards
  const comparison = isZh
    ? ['音乐生成', '图片生成', '视频生成', '商用授权', '任务广场加权', 'API 访问']
    : ['Music generation', 'Image generation', 'Video generation', 'Commercial use', 'Task Plaza boost', 'API access']

  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Plans', '套餐')} title={textFor(t, 'Unlock the full AI creative platform', '解锁完整 AI 创作平台')} />
      <div className="billing-toggle">
        <button className={billing === 'year' ? 'active' : ''} type="button" onClick={() => setBilling('year')}>
          {t.billingYear}
        </button>
        <button className={billing === 'month' ? 'active' : ''} type="button" onClick={() => setBilling('month')}>
          {t.billingMonth}
        </button>
      </div>
      <div className="plan-grid">
        {plans.map((plan) => (
          <article className={plan.badge ? 'plan-card featured' : 'plan-card'} key={plan.name}>
            {plan.badge && <span className="pill small">{plan.badge}</span>}
            <h3>{plan.name}</h3>
            <strong>
              {plan.price}
              <span>{textFor(t, '/mo', '/月')}</span>
            </strong>
            <p>{plan.credits}</p>
            <ul>
              <li>{textFor(t, 'Music generation', '音乐生成')}: {plan.songs}</li>
              <li>{textFor(t, 'Image credits included', '包含图片积分')}</li>
              <li>{textFor(t, 'Video generation queue', '视频生成队列')}</li>
              <li>{textFor(t, 'Chat assistant usage', '对话助手额度')}</li>
              <li>{textFor(t, 'Community and Task Plaza', '社区与任务广场')}</li>
            </ul>
            <button className="primary-button" type="button" onClick={requireAuth}>
              {textFor(t, 'Get plan', '选择套餐')}
            </button>
          </article>
        ))}
      </div>
      <section className="panel comparison">
        <SectionHeader title={textFor(t, 'Feature comparison', '功能对比')} />
        {comparison.map((feature) => (
          <div className="compare-row" key={feature}>
            <span>{feature}</span>
            <Check size={18} />
            <Check size={18} />
            <Check size={18} />
            <Check size={18} />
          </div>
        ))}
      </section>
    </div>
  )
}

function ApiPage({
  t,
  requireAuth,
  simulateAction,
}: {
  t: Record<string, string>
  requireAuth: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const features = isZh
    ? [
        '音乐 AI',
        '图片生成',
        '文生视频',
        '声音生成器',
        '文本朗读',
        'AI 翻唱',
        '分轨拆分',
        '歌词生成',
        'BPM 检测',
      ]
    : apiFeatures
  const [selectedFeature, setSelectedFeature] = useState(features[0])

  return (
    <div className="stack">
      <section className="api-hero">
        <div>
          <span className="eyebrow">{textFor(t, 'Developer platform', '开发者平台')}</span>
          <h1>{textFor(t, 'Audio, image, video, and chat APIs for creative apps.', '面向创作应用的音频、图片、视频和对话 API。')}</h1>
          <p>{textFor(t, 'Integrate generation, editing, transcription, and analysis with one consistent API surface.', '用统一接口接入生成、编辑、转写和分析能力。')}</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={requireAuth}>
              <BadgeDollarSign size={17} />
              {textFor(t, '$20 credit', '¥140 测试额度')}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                simulateAction(isZh ? '已打开 API 文档目录：音乐、图片、视频、对话接口' : 'API docs opened: music, image, video, and chat endpoints')
              }
            >
              <Code2 size={17} />
              {t.docs}
            </button>
          </div>
        </div>
        <pre className="code-card">{`await museflow.generate({
  type: "music-video",
  prompt: "neon lofi lyric loop",
  duration: 8
})`}</pre>
      </section>
      <div className="tool-grid">
        {features.map((feature) => (
          <button
            className={selectedFeature === feature ? 'tool-card active' : 'tool-card'}
            type="button"
            key={feature}
            onClick={() => {
              setSelectedFeature(feature)
              simulateAction(isZh ? `已选择 API 能力：${feature}` : `API capability selected: ${feature}`)
            }}
          >
            <Code2 size={19} />
            <span>{feature}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function EarnPage({ t, requireAuth }: { t: Record<string, string>; requireAuth: () => void }) {
  const plans = isZhCopy(t) ? ['Plus 年付', 'Pro 年付', 'Ultra 年付'] : ['Plus Yearly', 'Pro Yearly', 'Ultra Yearly']
  return (
    <div className="stack">
      <section className="hero-section slim">
        <div className="hero-copy">
          <span className="pill">
            <BadgeDollarSign size={16} />
            {textFor(t, 'Partner program', '合作伙伴计划')}
          </span>
          <h1>{textFor(t, 'Earn 20%-50% commission from AI creators.', '面向 AI 创作者获得 20%-50% 分成。')}</h1>
          <p>{textFor(t, 'Share MuseFlow with musicians, designers, video editors, prompt engineers, and agencies.', '把 MuseFlow 推荐给音乐人、设计师、视频剪辑师、提示词工程师和机构客户。')}</p>
          <button className="primary-button large" type="button" onClick={requireAuth}>
            {t.earn}
          </button>
        </div>
      </section>
      <div className="plan-grid compact">
        {plans.map((plan, index) => (
          <article className="plan-card" key={plan}>
            <h3>{plan}</h3>
            <strong>{20 + index * 15}%</strong>
            <p>{textFor(t, 'Recurring commission with dashboard tracking.', '循环分成，后台可跟踪转化和结算。')}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

function AboutPage({ t }: { t: Record<string, string> }) {
  const cards = isZhCopy(t)
    ? ['创作者计划', '任务广场', '商用授权']
    : ['Creator program', 'Hiring board', 'Commercial licensing']
  return (
    <div className="stack">
      <section className="panel readable">
        <span className="eyebrow">{t.about}</span>
        <h1>{textFor(t, 'MuseFlow is a front-end prototype for an AI creative network.', 'MuseFlow 是一个 AI 创作协作网络的前端原型。')}</h1>
        <p>
          {textFor(
            t,
            'It combines generation studios, discovery, profiles, a task marketplace, and a forum-like community into one MusicGPT-inspired product experience.',
            '它把生成工作台、探索、个人主页、任务广场和论坛式社区整合成一个 MusicGPT 风格的产品体验。',
          )}
        </p>
      </section>
      <div className="content-grid three">
        {cards.map((item) => (
          <article className="metric-card" key={item}>
            <Sparkles size={22} />
            <strong>{item}</strong>
            <span>{textFor(t, 'Static page-ready content block', '静态页面内容模块')}</span>
          </article>
        ))}
      </div>
    </div>
  )
}

function PlaylistPage({
  t,
  playTrack,
  simulateAction,
}: {
  t: Record<string, string>
  playTrack: (track: Track) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [liked, setLiked] = useState(false)

  return (
    <div className="stack">
      <section className="playlist-header">
        <img src={tracks[0].cover} alt="" />
        <div>
          <span className="eyebrow">{t.playlists}</span>
          <h1>Top 100</h1>
          <p>{textFor(t, 'Discover the top tracks, covers, and creator-made AI songs across every mood.', '发现不同情绪下最受欢迎的曲目、翻唱和创作者 AI 歌曲。')}</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => playTrack(tracks[0])}>
              <Play size={17} fill="currentColor" />
              {textFor(t, 'Play', '播放')}
            </button>
            <button
              className={liked ? 'ghost-button active' : 'ghost-button'}
              type="button"
              onClick={() => {
                setLiked((current) => !current)
                simulateAction(
                  liked
                    ? isZh
                      ? '已取消收藏播放列表 Top 100'
                      : 'Playlist removed from liked: Top 100'
                    : isZh
                      ? '已收藏播放列表 Top 100'
                      : 'Playlist liked: Top 100',
                )
              }}
            >
              <Heart size={17} />
              {liked ? '98.1K' : '98K'}
            </button>
          </div>
        </div>
      </section>
      <div className="panel">
        {tracks.map((track) => (
          <TrackRow key={track.id} t={t} track={track} playTrack={playTrack} />
        ))}
      </div>
    </div>
  )
}

function ProfilePage({
  t,
  profile,
  setPage,
  openProfile,
  simulateAction,
}: {
  t: Record<string, string>
  profile: MarketplaceProfile
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const tabs = [
    textFor(t, 'Overview', '概览'),
    textFor(t, 'Delivered work', '交付成果'),
    textFor(t, 'Reviews', '评价'),
    textFor(t, 'Published briefs', '发布需求'),
  ]
  const [activeTab, setActiveTab] = useState(tabs[0])
  const tags = profileTags(profile, t)
  const profileTasks = localizedTasks(tasks, t).filter((task) => task.assignee === profile.handle || task.publisher === profile.handle)
  const deliveredTasks = profileTasks.filter((task) => task.assignee === profile.handle)
  const postedTasks = profileTasks.filter((task) => task.publisher === profile.handle)
  const relatedProfiles = marketplaceProfiles
    .filter((item) => item.id !== profile.id && item.categories.some((category) => profile.categories.includes(category)))
    .slice(0, 4)
  const displayedTasks =
    activeTab === tabs[3] ? postedTasks : activeTab === tabs[1] ? deliveredTasks : profileTasks.slice(0, 4)

  return (
    <div className="stack">
      <section className="profile-shell">
        <aside className="profile-card public-profile-card">
          <div className="profile-cover" />
          <div className="profile-body">
            <div className="profile-avatar">{profile.initials}</div>
            <div className="profile-name">
              <strong>{localizeText(profile.name, t)}</strong>
              <span>@{profile.handle} · {localizeText(profile.role, t)}</span>
            </div>
            <p>{localizeText(profile.bio, t)}</p>
            <div className="profile-stats">
              <div className="profile-stat">
                <strong>{profile.stats.score}</strong>
                <span>{isZh ? '信誉分' : 'score'}</span>
              </div>
              <div className="profile-stat">
                <strong>{profile.stats.completed}</strong>
                <span>{isZh ? '已交付' : 'delivered'}</span>
              </div>
              <div className="profile-stat">
                <strong>{profile.stats.posted}</strong>
                <span>{isZh ? '已发布' : 'posted'}</span>
              </div>
            </div>
            <div className="skill-cloud">
              {tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
            <div className="quick-action-row">
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  simulateAction(
                    isZh ? `已模拟关注 @${profile.handle}` : `Followed @${profile.handle} in the front-end mock`,
                    { description: `Followed profile: @${profile.handle}`, delta: '+1' },
                  )
                }
              >
                <UserRound size={17} />
                {t.follow}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => simulateAction(isZh ? `已复制用户主页链接：@${profile.handle}` : `Profile link copied: @${profile.handle}`)}
              >
                <Share2 size={17} />
                {t.share}
              </button>
            </div>
          </div>
        </aside>
        <section className="public-panel">
          <div className="profile-hero-row">
            <div>
              <span className="eyebrow">{textFor(t, 'Public profile', '公开主页')}</span>
              <h1>{localizeText(profile.name, t)}</h1>
              <p>{localizeText(profile.bio, t)}</p>
            </div>
            <div className="profile-rank-card">
              <span>{textFor(t, 'Marketplace rank', '广场排名')}</span>
              <strong>{profile.stats.rank}</strong>
              <small>
                {textFor(t, 'Response', '响应')} {profile.stats.response} · {textFor(t, 'Acceptance', '通过率')} {profile.stats.acceptance}
              </small>
            </div>
          </div>
          <div className="profile-proof-grid">
            <article>
              <span>{textFor(t, 'Earned', '获得积分')}</span>
              <strong>{profile.stats.earned}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Paid out', '结算金额')}</span>
              <strong>{profile.stats.paid}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Languages', '语言')}</span>
              <strong>{profile.languages.join(' / ')}</strong>
            </article>
            <article>
              <span>{textFor(t, 'Categories', '分类')}</span>
              <strong>{profile.categories.map((category) => categoryLabel(category, t)).join(' / ')}</strong>
            </article>
          </div>
          <div className="badge-row">
            {profile.badges.map((badge) => (
              <span className="pill small" key={badge.en}>{localizeText(badge, t)}</span>
            ))}
          </div>
        </section>
      </section>
      <div className="chip-row">
        {tabs.map((item) => (
          <button
            className={activeTab === item ? 'chip active' : 'chip'}
            type="button"
            key={item}
            onClick={() => {
              setActiveTab(item)
              simulateAction(isZh ? `已切换用户主页内容：${item}` : `Public profile tab changed: ${item}`)
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="profile-layout-grid">
        <section className="panel">
          <SectionHeader
            eyebrow={textFor(t, 'Proof', '能力证明')}
            title={activeTab}
            action={
              <button className="ghost-button" type="button" onClick={() => setPage('tasks')}>
                <BriefcaseBusiness size={17} />
                {textFor(t, 'Task Plaza', '任务广场')}
              </button>
            }
          />
          {activeTab === tabs[2] ? (
            <div className="review-list">
              {profile.reviews.map((review) => (
                <Comment author={profile.handle} text={localizeText(review, t)} key={review.en} />
              ))}
            </div>
          ) : (
            <div className="proof-list">
              {displayedTasks.length ? (
                displayedTasks.map((task) => (
                  <div className="proof-item task-proof-item" key={task.id}>
                    <StatusBadge status={task.status} t={t} />
                    <strong>{task.title}</strong>
                    <span>
                      {categoryLabel(task.category, t)} · {task.points} · @{task.publisher}
                    </span>
                  </div>
                ))
              ) : (
                profile.portfolio.map((item) => (
                  <div className="proof-item task-proof-item" key={item.en}>
                    <StatusBadge status="Completed" t={t} />
                    <strong>{localizeText(item, t)}</strong>
                    <span>{textFor(t, 'Portfolio item from public profile', '公开主页作品案例')}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
        <aside className="panel">
          <SectionHeader eyebrow={textFor(t, 'Related users', '相关用户')} title={textFor(t, 'People to compare', '可对比用户')} />
          <div className="rank-list compact-list">
            {relatedProfiles.map((item) => (
              <button className="rank-row" type="button" key={item.id} onClick={() => openProfile(item)}>
                <span className="avatar compact">{item.initials}</span>
                <span className="rank-copy">
                  <strong>{localizeText(item.name, t)}</strong>
                  <small>@{item.handle} · {profileTags(item, t).slice(0, 2).join(' / ')}</small>
                </span>
                <span className="rank-metric">
                  <strong>{item.stats.score}</strong>
                  <small>{isZh ? '分' : 'score'}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function LegalPage({ title, t }: { title: string; t: Record<string, string> }) {
  return (
    <section className="panel readable">
      <span className="eyebrow">{textFor(t, 'Legal', '法律')}</span>
      <h1>{title}</h1>
      <p>
        {textFor(
          t,
          'This prototype includes static legal content placeholders for product terms, privacy language, usage rights, commercial licensing, task marketplace rules, and community moderation policies.',
          '这个原型包含服务条款、隐私说明、使用权、商用授权、任务广场规则和社区治理政策的静态占位内容。',
        )}
      </p>
    </section>
  )
}

type IslandAction = {
  page: Page
  label: string
  hint: string
  icon: ReactNode
  keys: string[]
}

function DynamicIsland({
  locale,
  page,
  setPage,
  simulateAction,
}: {
  locale: Locale
  page: Page
  setPage: (page: Page) => void
  simulateAction: SimulateAction
}) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [query, setQuery] = useState('')
  const isZh = locale === 'zh'
  const pageGuide: Partial<Record<Page, [string, string]>> = {
    home: isZh
      ? ['AI 指引', '告诉我你想做什么，我带你进入任务、社区或创作工具。']
      : ['AI Guide', 'Tell me what you want to do and I will route you to tasks, community, or tools.'],
    tasks: isZh
      ? ['任务广场助手', '筛选需求、查看详情、接取任务或快速发布新需求。']
      : ['Task Plaza Helper', 'Filter work, inspect details, claim a task, or publish a new brief.'],
    community: isZh
      ? ['社区阅读助手', '浏览话题、进入详情、回复帖子，也可以把讨论转成任务。']
      : ['Community Helper', 'Browse topics, open details, reply, or turn a discussion into a task.'],
    publish: isZh
      ? ['发布需求助手', '补全目标、交付物、验收标准和奖励规则后发布。']
      : ['Briefing Helper', 'Complete goals, deliverables, acceptance rules, and reward terms.'],
    mine: isZh
      ? ['我的任务助手', '跟踪已接取、待提交和待验收的任务进度。']
      : ['My Task Helper', 'Track claimed, submitted, and review-stage work.'],
    engine: isZh
      ? ['任务引擎助手', '把模糊想法拆成可执行的任务卡和验收说明。']
      : ['Task Engine Helper', 'Turn rough ideas into scoped tasks and acceptance notes.'],
    chat: isZh
      ? ['对话助手', '用对话生成提示词、验收标准、回复或任务说明。']
      : ['Chat Helper', 'Draft prompts, acceptance criteria, replies, and task briefs.'],
    image: isZh
      ? ['图片生成助手', '生成封面、海报、商品图和任务交付视觉素材。']
      : ['Image Helper', 'Generate covers, posters, product shots, and task visuals.'],
    video: isZh
      ? ['视频制作助手', '制作脚本、分镜、文生视频和图生视频方案。']
      : ['Video Helper', 'Plan scripts, shots, text-to-video, and image-to-video concepts.'],
    inspiration: isZh
      ? ['灵感库助手', '沉淀帖子、Prompt、教程和可复用交付模板。']
      : ['Library Helper', 'Collect posts, prompts, tutorials, and reusable delivery templates.'],
    points: isZh
      ? ['积分助手', '查看贡献记录、待结算奖励和兑换入口。']
      : ['Rewards Helper', 'Review contribution history, pending rewards, and redemptions.'],
  }
  const actions: IslandAction[] = [
    {
      page: 'tasks',
      label: isZh ? '去任务广场' : 'Open Task Plaza',
      hint: isZh ? '找可接取的 AI 需求，查看预算、周期和验收标准。' : 'Find AI work with budgets, timelines, and acceptance rules.',
      icon: <BriefcaseBusiness size={17} />,
      keys: ['task', 'tasks', 'market', 'job', 'work', '接', '任务', '赚钱', '需求'],
    },
    {
      page: 'publish',
      label: isZh ? '发布需求' : 'Publish Brief',
      hint: isZh ? '把想法整理成任务标题、交付物和验收规则。' : 'Turn an idea into title, deliverables, and review rules.',
      icon: <PenLine size={17} />,
      keys: ['publish', 'post', 'brief', 'request', '发布', '发任务', '需求', '悬赏'],
    },
    {
      page: 'community',
      label: isZh ? '进入社区' : 'Open Community',
      hint: isZh ? '查看话题列表、发帖、回复或把帖子转成任务。' : 'Read topics, post, reply, or convert a discussion into work.',
      icon: <MessageCircle size={17} />,
      keys: ['community', 'forum', 'post', 'reply', 'topic', '社区', '论坛', '帖子', '回复'],
    },
    {
      page: 'image',
      label: isZh ? '生成图片' : 'Generate Images',
      hint: isZh ? '进入图片工作台，生成封面、商品图和参考图。' : 'Use the image studio for covers, product visuals, and references.',
      icon: <Image size={17} />,
      keys: ['image', 'cover', 'poster', 'picture', '图片', '封面', '海报', '商品图'],
    },
    {
      page: 'video',
      label: isZh ? '制作视频' : 'Make Video',
      hint: isZh ? '进入视频工作台，测试脚本、分镜和生成流程。' : 'Open the video studio for scripts, shots, and generation flows.',
      icon: <Video size={17} />,
      keys: ['video', 'movie', 'clip', '视频', '短视频', '分镜', '文生视频'],
    },
    {
      page: 'chat',
      label: isZh ? '基础对话' : 'AI Chat',
      hint: isZh ? '用对话快速生成需求、提示词、回复和验收说明。' : 'Draft briefs, prompts, replies, and acceptance notes in chat.',
      icon: <Bot size={17} />,
      keys: ['chat', 'ask', 'prompt', '对话', '聊天', '提示词', '问答'],
    },
    {
      page: 'points',
      label: isZh ? '积分奖励' : 'Rewards',
      hint: isZh ? '查看贡献积分、奖励和任务结算记录。' : 'Inspect contribution points, rewards, and task settlement history.',
      icon: <Trophy size={17} />,
      keys: ['points', 'reward', 'bonus', '积分', '奖励', '兑换'],
    },
  ]
  const currentGuide = pageGuide[page] || pageGuide.home!
  const primaryAction = actions.find((item) => item.page === page) || actions[0]
  const suggestions = actions.filter((item) => item.page !== page).slice(0, 5)

  const runGuide = (raw: string) => {
    const value = raw.trim().toLowerCase()
    const action = value
      ? actions.find((item) => item.keys.some((key) => value.includes(key.toLowerCase()))) || actions[0]
      : primaryAction
    setPage(action.page)
    setOpen(false)
    simulateAction(
      isZh ? `灵动岛已跳转：${action.label}` : `Dynamic island routed: ${action.label}`,
      { description: `Dynamic island guide: ${action.label}`, delta: '+1' },
    )
  }

  if (minimized) {
    return (
      <button
        className="ai-island-float"
        type="button"
        aria-label={isZh ? '展开 AI 灵动岛' : 'Expand AI guide'}
        title={isZh ? '展开 AI 灵动岛' : 'Expand AI guide'}
        onClick={() => {
          setMinimized(false)
          setOpen(false)
          simulateAction(isZh ? 'AI 灵动岛已展开' : 'AI guide expanded')
        }}
      >
        <span className="island-orb">AI</span>
      </button>
    )
  }

  return (
    <section className={`ai-island ${open ? 'open' : ''}`} aria-label={isZh ? 'AI 灵动岛指引' : 'AI dynamic island guide'}>
      <div className="island-compact">
        <button className="island-core" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span className="island-orb">AI</span>
          <span className="island-status">
            <strong>{currentGuide[0]}</strong>
            <span>{currentGuide[1]}</span>
          </span>
        </button>
        <div className="island-fast" aria-label={isZh ? '快捷功能' : 'Quick actions'}>
          {actions.slice(0, 5).map((action) => (
            <button
              className={action.page === page ? 'island-icon active' : 'island-icon'}
              type="button"
              aria-label={action.label}
              title={action.label}
              key={action.page}
              onClick={() => runGuide(action.label)}
            >
              {action.icon}
            </button>
          ))}
        </div>
        <button className="ghost-button island-toggle" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? (isZh ? '收起' : 'Close') : isZh ? '展开' : 'Open'}
        </button>
        <button
          className="island-minimize"
          type="button"
          aria-label={isZh ? '收起到右侧悬浮按钮' : 'Minimize to floating button'}
          title={isZh ? '收起到右侧' : 'Minimize'}
          onClick={() => {
            setOpen(false)
            setMinimized(true)
            simulateAction(isZh ? 'AI 灵动岛已收起到右侧' : 'AI guide minimized to the right')
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="island-expanded">
        <div className="island-command">
          <input
            value={query}
            placeholder={isZh ? '例如：我要发布任务 / 找任务赚钱 / 发帖 / 生成图片 / 做视频' : 'Try: publish a task / find work / reply in forum / generate images / make video'}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runGuide(query)
              }
            }}
          />
          <button className="primary-button" type="button" onClick={() => runGuide(query)}>
            {isZh ? '帮我找到' : 'Route me'}
          </button>
        </div>
        <div className="island-guide">
          <article className="guide-card">
            <strong>{primaryAction.label}</strong>
            <span>{primaryAction.hint}</span>
          </article>
          <article className="guide-card">
            <strong>{currentGuide[0]}</strong>
            <span>{currentGuide[1]}</span>
          </article>
        </div>
        <div className="island-suggestions">
          {suggestions.map((action) => (
            <button className="chip" type="button" key={action.page} onClick={() => runGuide(action.label)}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function MiniPlayer({
  t,
  track,
  playTrack,
  playing,
  setPlaying,
  playerOpen,
  setPlayerOpen,
  requireAuth,
  simulateAction,
}: {
  t: Record<string, string>
  track: Track
  playTrack: (track: Track) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
  playerOpen: boolean
  setPlayerOpen: (open: boolean) => void
  requireAuth: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [shuffleOn, setShuffleOn] = useState(false)
  const [repeatOn, setRepeatOn] = useState(false)

  return (
    <aside className={playerOpen ? 'mini-player open' : 'mini-player'} aria-label={textFor(t, 'Music player', '音乐播放器')}>
      <button className="player-widget-toggle" type="button" onClick={() => setPlayerOpen(!playerOpen)}>
        <img src={track.cover} alt="" />
        <span className={playing ? 'status-dot loading' : 'status-dot idle'} />
        <strong>{track.title}</strong>
        <small>{track.artist}</small>
      </button>
      {playerOpen && (
        <div className="player-widget-panel">
          <div className="player-widget-head">
            <div>
              <span className="eyebrow">{textFor(t, 'Now playing', '正在播放')}</span>
              <strong>{track.title}</strong>
              <small>{track.artist} · {track.duration}</small>
            </div>
            <button className="icon-button small" type="button" onClick={() => setPlayerOpen(false)} aria-label={textFor(t, 'Collapse player', '收起播放器')}>
              <X size={16} />
            </button>
          </div>
          <button className="player-progress" type="button" onClick={() => setPlayerOpen(true)}>
            <span />
            <small>01:14 / {track.duration}</small>
          </button>
          <div className="player-controls">
          <button
            className={shuffleOn ? 'active' : ''}
            type="button"
            onClick={() => {
              setShuffleOn((current) => !current)
              simulateAction(
                shuffleOn
                  ? isZh
                    ? '已关闭随机播放'
                    : 'Shuffle disabled'
                  : isZh
                    ? '已开启随机播放'
                    : 'Shuffle enabled',
              )
            }}
          >
            <Shuffle size={17} />
          </button>
          <button className="round-control" type="button" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button
            className={repeatOn ? 'active' : ''}
            type="button"
            onClick={() => {
              setRepeatOn((current) => !current)
              simulateAction(
                repeatOn
                  ? isZh
                    ? '已关闭循环播放'
                    : 'Repeat disabled'
                  : isZh
                    ? '已开启循环播放'
                    : 'Repeat enabled',
              )
            }}
          >
            <RefreshCcw size={17} />
          </button>
          </div>
          <div className="player-actions">
            <button type="button" onClick={requireAuth} title={textFor(t, 'Comments', '评论')}>
              <MessageCircle size={17} />
            </button>
            <button type="button" onClick={requireAuth} title={textFor(t, 'Like', '喜欢')}>
              <Heart size={17} />
            </button>
            <button type="button" onClick={requireAuth} title={t.share}>
              <Share2 size={17} />
            </button>
          </div>
          <div className="hot-song-list">
            <div className="panel-title">
              <strong>{textFor(t, 'Hot songs', '热门歌曲')}</strong>
              <span>{textFor(t, 'Tap to switch the current track', '点击切换当前播放')}</span>
            </div>
            {tracks.slice(0, 5).map((item) => (
              <button
                className={item.id === track.id ? 'hot-song active' : 'hot-song'}
                type="button"
                key={item.id}
                onClick={() => {
                  playTrack(item)
                  simulateAction(isZh ? `已切换热门歌曲：${item.title}` : `Hot song selected: ${item.title}`)
                }}
              >
                <img src={item.cover} alt="" />
                <span>
                  <strong>{item.title}</strong>
                  <small>@{item.artist} · {item.plays}</small>
                </span>
                <Play size={15} fill="currentColor" />
              </button>
            ))}
          </div>
          <div className="lyric-panel compact">
            <span className="eyebrow">{textFor(t, 'Prompt', '提示词')}</span>
            <p>{track.prompt}</p>
          </div>
        </div>
      )}
    </aside>
  )
}

function SearchPanel({
  t,
  close,
  playTrack,
  setPage,
  openProfile,
  selectedSearchFilter,
  setSelectedSearchFilter,
  simulateAction,
}: {
  t: Record<string, string>
  close: () => void
  playTrack: (track: Track) => void
  setPage: (page: Page) => void
  openProfile: (profile: MarketplaceProfile) => void
  selectedSearchFilter: string
  setSelectedSearchFilter: (filter: string) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const [query, setQuery] = useState('')
  const filters = [t.all, t.songs, t.playlists, t.sfx, t.users, t.tasks, t.posts]
  const defaultTags = isZh
    ? ['中文课程宣传片', '国风 Lo-fi', '小红书封面', 'AI 配音', '任务验收']
    : ['Product launch video', 'Lofi chorus', 'Album cover', 'AI voiceover', 'Acceptance criteria']

  const results = useMemo(() => {
    if (!query.trim()) return tracks.slice(0, 3)
    return tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase())).concat(tracks.slice(0, 2))
  }, [query])

  return (
    <div className="search-backdrop" onClick={close}>
      <section className="search-panel" onClick={(event) => event.stopPropagation()}>
        <div className="search-input">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />
          <button type="button" onClick={close}>
            <X size={17} />
          </button>
        </div>
        {!query && (
          <div className="tag-list">
            {defaultTags.map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => {
                  setQuery(tag)
                  simulateAction(isZh ? `已选择搜索标签：${tag}` : `Search tag selected: ${tag}`)
                }}
              >
                <Aperture size={15} />
                {tag}
              </button>
            ))}
          </div>
        )}
        {query && (
          <div className="chip-row">
            {filters.map((filter) => (
              <button
                className={selectedSearchFilter === filter ? 'chip active' : 'chip'}
                type="button"
                key={filter}
                onClick={() => {
                  setSelectedSearchFilter(filter)
                  simulateAction(isZh ? `已切换搜索类型：${filter}` : `Search filter changed: ${filter}`)
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        )}
        <div className="search-results">
          <button
            type="button"
            className="search-result"
            onClick={() => {
              setPage('playlist')
              simulateAction(isZh ? '已打开搜索结果：Top 50 播放列表' : 'Search result opened: Top 50 playlist')
              close()
            }}
          >
            <ListMusic size={18} />
            <span>
              <strong>Top 50</strong>
              <small>@musicgpt · {textFor(t, 'Playlist', '播放列表')} · 50K {textFor(t, 'likes', '点赞')}</small>
            </span>
            <Star size={16} />
          </button>
          {results.map((track) => (
            <button
              type="button"
              className="search-result"
              key={track.id}
              onClick={() => {
                playTrack(track)
                simulateAction(isZh ? `已播放搜索结果：${track.title}` : `Search result played: ${track.title}`)
                close()
              }}
            >
              <img src={track.cover} alt="" />
              <span>
                <strong>{track.title}</strong>
                <small>
                  @{track.artist} · {track.plays} {textFor(t, 'plays', '播放')}
                </small>
              </span>
              <Download size={16} />
            </button>
          ))}
          <button
            type="button"
            className="search-result"
            onClick={() => {
              const profile = isZh ? findProfile('coursecn') ?? marketplaceProfiles[0] : findProfile('iriswood') ?? marketplaceProfiles[0]
              openProfile(profile)
              simulateAction(isZh ? `已打开搜索结果：${localizeText(profile.name, t)} 用户主页` : `Search result opened: ${localizeText(profile.name, t)} profile`)
              close()
            }}
          >
            <UserRound size={18} />
            <span>
              <strong>{isZh ? '中文课程组' : 'Iris Wood'}</strong>
              <small>@{isZh ? 'coursecn' : 'iriswood'} · {textFor(t, 'public profile', '公开主页')}</small>
            </span>
            <Star size={16} />
          </button>
        </div>
      </section>
    </div>
  )
}

function LoginModal({
  t,
  close,
  simulateAction,
}: {
  t: Record<string, string>
  close: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const providers = isZh ? ['微信登录', '手机号登录', '邮箱登录', 'Google', 'Apple'] : ['Google', 'Apple', 'Discord', 'Facebook', 'Email']
  const [selectedProvider, setSelectedProvider] = useState('')

  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="login-modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" type="button" onClick={close}>
          <X size={18} />
        </button>
        <h2>{textFor(t, 'Login or sign up', '登录或注册')}</h2>
        {providers.map((provider) => (
          <button
            className={selectedProvider === provider ? 'social-login active' : 'social-login'}
            type="button"
            key={provider}
            onClick={() => {
              setSelectedProvider(provider)
              simulateAction(isZh ? `已选择登录方式：${provider}，当前为前端模拟登录` : `Login method selected: ${provider}. This is a front-end mock.`)
            }}
          >
            <Globe2 size={18} />
            {isZh ? `使用 ${provider} 继续` : `Continue with ${provider}`}
          </button>
        ))}
        <p>
          {textFor(t, 'By continuing, you agree to our', '继续即表示你同意')} {t.terms} {textFor(t, 'and', '和')} {t.privacy}.
        </p>
      </section>
    </div>
  )
}

function Comment({ author, text }: { author: string; text: string }) {
  return (
    <div className="comment">
      <div className="avatar">{author.slice(0, 1).toUpperCase()}</div>
      <div>
        <strong>{author}</strong>
        <p>{text}</p>
      </div>
    </div>
  )
}

export default App

/**
 * The words on the page, in English, Turkish and Russian.
 *
 * The language is chosen once, when the page loads: a choice made in the menu
 * if there is one, otherwise the first of the browser's preferred languages
 * that we speak, otherwise English. Fixed for the life of the page on purpose —
 * the menu reloads to switch — so `t` can be a plain function rather than a
 * context every component has to subscribe to.
 *
 * English is the source of truth. The other two are typed against it, so a
 * key added here and not translated there fails the build instead of showing
 * up as a raw key on somebody's screen.
 */

export const LANGUAGES = ["en", "tr", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language named in itself, which is how people look for their own. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  tr: "Türkçe",
  ru: "Русский",
};

const STORAGE_KEY = "code-together:language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function detect(): Language {
  try {
    const chosen = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(chosen)) return chosen;
  }
  catch {
    // storage blocked; fall through to the browser's own preference
  }
  const preferred = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    // "tr-TR" → "tr"; region does not change any word we show
    const base = tag?.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

export const language: Language = detect();

if (typeof document !== "undefined") document.documentElement.lang = language;

/** Remember a choice made in the menu, and reload into it. */
export function chooseLanguage(next: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  }
  catch {
    // without storage the choice cannot outlive the reload; nothing to do
  }
  window.location.reload();
}

/** For dates, in the language of the words around them. */
export function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, options);
}

type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const en = {
  "menu.document": "Document",
  "menu.new": "New document…",
  "menu.unlock": "Unlock editing…",
  "menu.html": "Download as HTML",
  "menu.markdown": "Download as Markdown",
  "menu.print": "Print, or save as PDF",
  "menu.history": "Version history",
  "menu.attachments": "Attachments",
  "menu.recent": "Recent",
  "menu.language": "Language",
  "expiry.menu": "Delete automatically…",
  "expiry.title": "Delete this document automatically",
  "expiry.note": "When the time comes, the document, its history and its attachments are deleted for everyone. That cannot be undone.",
  "expiry.never": "Never",
  "expiry.1h": "In 1 hour",
  "expiry.24h": "In 24 hours",
  "expiry.7d": "In 7 days",
  "expiry.30d": "In 30 days",
  "expiry.current": "Now set to delete on {when}.",
  "expiry.save": "Save",
  "expiry.saving": "Saving…",
  "expiry.failed": "Could not change when this document is deleted.",
  "expiry.badge": "Deletes in {left}",
  "expiry.badgeHint": "This document deletes itself on {when}.",
  "expiry.gone": "This document has expired",
  "expiry.goneNote": "It was deleted, with its history and attachments, when its time ran out.",
  "expiry.newDocument": "Start a new document",
  "new.expiry": "Delete automatically",
  "new.badExpiry": "Pick one of the offered times.",

  "topbar.untitled": "Untitled document",
  "topbar.titleLabel": "Document title",
  "topbar.readOnly": "Read only",
  "topbar.readOnlyHint": "You can read this document but not change it.",
  "toc.title": "Contents",
  "toc.show": "Show contents",
  "toc.hide": "Hide contents",
  "toc.empty": "Headings appear here. Start a line with # to make one.",

  "save.saving": "Saving…",
  "save.saved": "Saved",
  "save.offline": "Offline",
  "save.offlineKept": "Not sent yet — kept on this device until the connection returns.",
  "save.offlineNotKept": "Not sent yet, and this browser cannot keep a local copy. Leave this tab open.",
  "save.savingHint": "Your changes are on their way to the server.",
  "save.savedHint": "Written to the server.",

  "status.connecting": "Connecting…",
  "status.syncing": "Syncing…",
  "status.offline": "Offline — your changes will be sent when the connection returns.",

  "problem.bad-id": "That is not a valid document address.",
  "problem.too-large": "This document has grown too large to open.",
  "problem.too-fast": "Slow down — some changes were not saved.",
  "problem.document-full": "This document is full; new changes are not being saved.",
  "problem.not-joined": "Not connected to the document yet.",
  "problem.locked": "This document needs its password. Reload the page to enter it.",
  "problem.read-only": "This document is read-only; your change was not saved.",
  "problem.expired": "This document has expired and was deleted.",

  "editor.placeholder": "Start typing, or paste a screenshot…",
  "code.auto": "Auto",
  "code.autoDetected": "Auto · {language}",
  "code.plain": "Plain text",

  "upload.tooLarge": "That picture is too large.",
  "upload.notImage": "That file is not an image we can store.",
  "upload.failedStatus": "Upload failed ({status}).",
  "upload.failed": "Upload failed.",
  "upload.dropped": "Upload failed: the connection dropped.",
  "upload.picture": "Could not upload that picture.",

  "attach.title": "Attachments",
  "attach.loadFailed": "Could not load the attachments.",
  "attach.fileTooLarge": "“{name}” is too large.",
  "attach.largerThan": "“{name}” is larger than {max}.",
  "attach.deleteFailed": "Could not delete that file.",
  "attach.attachFailed": "Could not attach “{name}”.",
  "attach.add": "Add files…",
  "attach.drop": "Or drop files here.",
  "attach.dropMax": "Or drop files here — up to {max} each.",
  "attach.empty": "No files attached yet.",
  "attach.keep": "Keep",
  "attach.download": "Download",

  "history.loadFailed": "Could not load the history.",
  "history.openFailed": "Could not open that version.",
  "history.restoreFailed": "Could not restore that version.",
  "history.empty": "Nothing saved yet. A version is kept every ten minutes while the document is being edited.",
  "history.open": "Open",

  "preview.label": "Version from {when}",
  "preview.show": "What to show",
  "preview.changes": "Changes",
  "preview.version": "This version",
  "preview.restore": "Restore this",
  "preview.restoring": "Restoring…",
  "preview.same": "Nothing would change — this version matches the document as it stands.",
  "preview.legend": "Struck through would be removed, highlighted would be added.",

  "new.title": "New document",
  "new.name": "Name",
  "new.namePlaceholder": "Meeting notes",
  "new.addressHint": "The address is made from the name.",
  "new.password": "Password",
  "new.optional": "Optional",
  "new.passwordAgain": "Password again",
  "new.mismatch": "The two passwords are not the same.",
  "new.protects": "The password protects",
  "new.protectView": "Viewing — nobody without it can open the document",
  "new.protectEdit": "Editing — everyone can read, only someone with the password can write",
  "new.keepSafe": "Keep the password somewhere safe: it cannot be recovered or changed.",
  "new.public": "Without a password the document is public: anyone with the address can read and edit it.",
  "new.create": "Create",
  "new.creating": "Creating…",
  "new.badName": "Use at least one letter or digit.",
  "new.taken": "A document already has that address. Pick another name.",
  "new.badPassword": "The password needs at least {min} characters.",
  "new.tooMany": "Too many documents made just now. Wait a minute and try again.",

  "unlock.viewTitle": "This document is password protected",
  "unlock.editTitle": "Unlock editing",
  "unlock.viewNote": "Enter the password to open it.",
  "unlock.editNote": "Anyone can read this document. Enter its password to edit it.",
  "unlock.wrong": "That is not the password.",
  "unlock.tooMany": "Too many attempts. Wait a minute and try again.",
  "unlock.submit": "Unlock",
  "unlock.checking": "Checking…",

  "presence.label": "People in this document",
  "presence.selfTitle": "{name} (you) — click to rename",
  "presence.selfLabel": "{name}, you. Rename yourself.",

  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.loading": "Loading…",
  "common.noServer": "Could not reach the server.",
} as const;

type Key = keyof typeof en;
type Dictionary = Record<Key, string>;

const tr: Dictionary = {
  "menu.document": "Belge",
  "menu.new": "Yeni belge…",
  "menu.unlock": "Düzenlemeyi aç…",
  "menu.html": "HTML olarak indir",
  "menu.markdown": "Markdown olarak indir",
  "menu.print": "Yazdır veya PDF olarak kaydet",
  "menu.history": "Sürüm geçmişi",
  "menu.attachments": "Ekler",
  "menu.recent": "Son açılanlar",
  "menu.language": "Dil",
  "expiry.menu": "Otomatik silme…",
  "expiry.title": "Bu belgeyi otomatik sil",
  "expiry.note": "Süre dolduğunda belge, geçmişi ve ekleri herkes için silinir. Bu geri alınamaz.",
  "expiry.never": "Hiçbir zaman",
  "expiry.1h": "1 saat sonra",
  "expiry.24h": "24 saat sonra",
  "expiry.7d": "7 gün sonra",
  "expiry.30d": "30 gün sonra",
  "expiry.current": "Şu an {when} tarihinde silinecek.",
  "expiry.save": "Kaydet",
  "expiry.saving": "Kaydediliyor…",
  "expiry.failed": "Belgenin silinme zamanı değiştirilemedi.",
  "expiry.badge": "{left} sonra silinecek",
  "expiry.badgeHint": "Bu belge {when} tarihinde kendini silecek.",
  "expiry.gone": "Bu belgenin süresi doldu",
  "expiry.goneNote": "Süresi dolunca geçmişi ve ekleriyle birlikte silindi.",
  "expiry.newDocument": "Yeni belge başlat",
  "new.expiry": "Otomatik sil",
  "new.badExpiry": "Sunulan sürelerden birini seç.",

  "topbar.untitled": "Adsız belge",
  "topbar.titleLabel": "Belge başlığı",
  "topbar.readOnly": "Salt okunur",
  "topbar.readOnlyHint": "Bu belgeyi okuyabilirsin ama değiştiremezsin.",
  "toc.title": "İçindekiler",
  "toc.show": "İçindekileri göster",
  "toc.hide": "İçindekileri gizle",
  "toc.empty": "Başlıklar burada görünür. Başlık için satıra # ile başla.",

  "save.saving": "Kaydediliyor…",
  "save.saved": "Kaydedildi",
  "save.offline": "Çevrimdışı",
  "save.offlineKept": "Henüz gönderilmedi; bağlantı dönene kadar bu cihazda tutuluyor.",
  "save.offlineNotKept": "Henüz gönderilmedi ve bu tarayıcı yerel kopya tutamıyor. Bu sekmeyi kapatma.",
  "save.savingHint": "Değişikliklerin sunucuya gönderiliyor.",
  "save.savedHint": "Sunucuya kaydedildi.",

  "status.connecting": "Bağlanıyor…",
  "status.syncing": "Eşitleniyor…",
  "status.offline": "Çevrimdışı — değişikliklerin bağlantı dönünce gönderilecek.",

  "problem.bad-id": "Bu geçerli bir belge adresi değil.",
  "problem.too-large": "Bu belge açılamayacak kadar büyüdü.",
  "problem.too-fast": "Biraz yavaşla — bazı değişiklikler kaydedilmedi.",
  "problem.document-full": "Bu belge doldu; yeni değişiklikler kaydedilmiyor.",
  "problem.not-joined": "Belgeye henüz bağlanılmadı.",
  "problem.locked": "Bu belge parola istiyor. Parolayı girmek için sayfayı yenile.",
  "problem.read-only": "Bu belge salt okunur; değişikliğin kaydedilmedi.",
  "problem.expired": "Bu belgenin süresi doldu ve silindi.",

  "editor.placeholder": "Yazmaya başla ya da bir ekran görüntüsü yapıştır…",
  "code.auto": "Otomatik",
  "code.autoDetected": "Otomatik · {language}",
  "code.plain": "Düz metin",

  "upload.tooLarge": "Bu resim çok büyük.",
  "upload.notImage": "Bu dosya saklayabildiğimiz türde bir resim değil.",
  "upload.failedStatus": "Yükleme başarısız ({status}).",
  "upload.failed": "Yükleme başarısız.",
  "upload.dropped": "Yükleme başarısız: bağlantı koptu.",
  "upload.picture": "Resim yüklenemedi.",

  "attach.title": "Ekler",
  "attach.loadFailed": "Ekler yüklenemedi.",
  "attach.fileTooLarge": "“{name}” çok büyük.",
  "attach.largerThan": "“{name}” en fazla {max} olabilir.",
  "attach.deleteFailed": "Dosya silinemedi.",
  "attach.attachFailed": "“{name}” eklenemedi.",
  "attach.add": "Dosya ekle…",
  "attach.drop": "Ya da dosyaları buraya bırak.",
  "attach.dropMax": "Ya da dosyaları buraya bırak — her biri en fazla {max}.",
  "attach.empty": "Henüz eklenmiş dosya yok.",
  "attach.keep": "Vazgeç",
  "attach.download": "İndir",

  "history.loadFailed": "Geçmiş yüklenemedi.",
  "history.openFailed": "Bu sürüm açılamadı.",
  "history.restoreFailed": "Bu sürüm geri yüklenemedi.",
  "history.empty": "Henüz kayıtlı sürüm yok. Belge düzenlenirken her on dakikada bir sürüm saklanır.",
  "history.open": "Aç",

  "preview.label": "{when} tarihli sürüm",
  "preview.show": "Ne gösterilsin",
  "preview.changes": "Değişiklikler",
  "preview.version": "Bu sürüm",
  "preview.restore": "Bunu geri yükle",
  "preview.restoring": "Geri yükleniyor…",
  "preview.same": "Hiçbir şey değişmez — bu sürüm belgenin şu anki haliyle aynı.",
  "preview.legend": "Üstü çizili olanlar silinir, vurgulananlar eklenir.",

  "new.title": "Yeni belge",
  "new.name": "Ad",
  "new.namePlaceholder": "Toplantı notları",
  "new.addressHint": "Adres, belgenin adından oluşturulur.",
  "new.password": "Parola",
  "new.optional": "İsteğe bağlı",
  "new.passwordAgain": "Parola (tekrar)",
  "new.mismatch": "İki parola aynı değil.",
  "new.protects": "Parola neyi korusun",
  "new.protectView": "Görüntülemeyi — parolasız kimse belgeyi açamaz",
  "new.protectEdit": "Düzenlemeyi — herkes okuyabilir, yalnızca parolayı bilen yazabilir",
  "new.keepSafe": "Parolayı güvenli bir yerde sakla: kurtarılamaz ve değiştirilemez.",
  "new.public": "Parola olmadan belge herkese açıktır: adresi bilen herkes okuyup düzenleyebilir.",
  "new.create": "Oluştur",
  "new.creating": "Oluşturuluyor…",
  "new.badName": "En az bir harf ya da rakam kullan.",
  "new.taken": "Bu adreste zaten bir belge var. Başka bir ad seç.",
  "new.badPassword": "Parola en az {min} karakter olmalı.",
  "new.tooMany": "Az önce çok fazla belge oluşturuldu. Bir dakika bekleyip tekrar dene.",

  "unlock.viewTitle": "Bu belge parolayla korunuyor",
  "unlock.editTitle": "Düzenlemeyi aç",
  "unlock.viewNote": "Açmak için parolayı gir.",
  "unlock.editNote": "Bu belgeyi herkes okuyabilir. Düzenlemek için parolasını gir.",
  "unlock.wrong": "Parola yanlış.",
  "unlock.tooMany": "Çok fazla deneme yapıldı. Bir dakika bekleyip tekrar dene.",
  "unlock.submit": "Aç",
  "unlock.checking": "Kontrol ediliyor…",

  "presence.label": "Bu belgedeki kişiler",
  "presence.selfTitle": "{name} (sen) — adını değiştirmek için tıkla",
  "presence.selfLabel": "{name}, sen. Adını değiştir.",

  "common.close": "Kapat",
  "common.cancel": "İptal",
  "common.delete": "Sil",
  "common.loading": "Yükleniyor…",
  "common.noServer": "Sunucuya ulaşılamadı.",
};

const ru: Dictionary = {
  "menu.document": "Документ",
  "menu.new": "Новый документ…",
  "menu.unlock": "Разрешить редактирование…",
  "menu.html": "Скачать как HTML",
  "menu.markdown": "Скачать как Markdown",
  "menu.print": "Печать или сохранение в PDF",
  "menu.history": "История версий",
  "menu.attachments": "Вложения",
  "menu.recent": "Недавние",
  "menu.language": "Язык",
  "expiry.menu": "Автоудаление…",
  "expiry.title": "Удалить документ автоматически",
  "expiry.note": "Когда время выйдет, документ, его история и вложения будут удалены для всех. Отменить это нельзя.",
  "expiry.never": "Никогда",
  "expiry.1h": "Через 1 час",
  "expiry.24h": "Через 24 часа",
  "expiry.7d": "Через 7 дней",
  "expiry.30d": "Через 30 дней",
  "expiry.current": "Сейчас документ будет удалён {when}.",
  "expiry.save": "Сохранить",
  "expiry.saving": "Сохранение…",
  "expiry.failed": "Не удалось изменить время удаления.",
  "expiry.badge": "Удалится через {left}",
  "expiry.badgeHint": "Документ удалит себя {when}.",
  "expiry.gone": "Срок действия документа истёк",
  "expiry.goneNote": "Он был удалён вместе с историей и вложениями, когда истёк срок.",
  "expiry.newDocument": "Создать новый документ",
  "new.expiry": "Удалить автоматически",
  "new.badExpiry": "Выберите один из предложенных сроков.",

  "topbar.untitled": "Документ без названия",
  "topbar.titleLabel": "Название документа",
  "topbar.readOnly": "Только чтение",
  "topbar.readOnlyHint": "Вы можете читать этот документ, но не изменять его.",
  "toc.title": "Содержание",
  "toc.show": "Показать содержание",
  "toc.hide": "Скрыть содержание",
  "toc.empty": "Здесь появятся заголовки. Начните строку с #, чтобы создать заголовок.",

  "save.saving": "Сохранение…",
  "save.saved": "Сохранено",
  "save.offline": "Офлайн",
  "save.offlineKept": "Ещё не отправлено — хранится на этом устройстве, пока не восстановится связь.",
  "save.offlineNotKept": "Ещё не отправлено, а этот браузер не может хранить локальную копию. Не закрывайте вкладку.",
  "save.savingHint": "Ваши изменения отправляются на сервер.",
  "save.savedHint": "Записано на сервер.",

  "status.connecting": "Подключение…",
  "status.syncing": "Синхронизация…",
  "status.offline": "Офлайн — изменения будут отправлены, когда восстановится связь.",

  "problem.bad-id": "Это неверный адрес документа.",
  "problem.too-large": "Документ стал слишком большим, чтобы его открыть.",
  "problem.too-fast": "Помедленнее — некоторые изменения не сохранились.",
  "problem.document-full": "Документ переполнен; новые изменения не сохраняются.",
  "problem.not-joined": "Подключение к документу ещё не установлено.",
  "problem.locked": "Для этого документа нужен пароль. Перезагрузите страницу, чтобы ввести его.",
  "problem.read-only": "Документ доступен только для чтения; изменение не сохранено.",
  "problem.expired": "Срок действия документа истёк, он удалён.",

  "editor.placeholder": "Начните печатать или вставьте скриншот…",
  "code.auto": "Авто",
  "code.autoDetected": "Авто · {language}",
  "code.plain": "Обычный текст",

  "upload.tooLarge": "Изображение слишком большое.",
  "upload.notImage": "Этот файл — не изображение, которое можно сохранить.",
  "upload.failedStatus": "Ошибка загрузки ({status}).",
  "upload.failed": "Ошибка загрузки.",
  "upload.dropped": "Ошибка загрузки: соединение прервалось.",
  "upload.picture": "Не удалось загрузить изображение.",

  "attach.title": "Вложения",
  "attach.loadFailed": "Не удалось загрузить вложения.",
  "attach.fileTooLarge": "Файл «{name}» слишком большой.",
  "attach.largerThan": "Файл «{name}» больше {max}.",
  "attach.deleteFailed": "Не удалось удалить файл.",
  "attach.attachFailed": "Не удалось прикрепить «{name}».",
  "attach.add": "Добавить файлы…",
  "attach.drop": "Или перетащите файлы сюда.",
  "attach.dropMax": "Или перетащите файлы сюда — до {max} каждый.",
  "attach.empty": "Файлов пока нет.",
  "attach.keep": "Оставить",
  "attach.download": "Скачать",

  "history.loadFailed": "Не удалось загрузить историю.",
  "history.openFailed": "Не удалось открыть эту версию.",
  "history.restoreFailed": "Не удалось восстановить эту версию.",
  "history.empty": "Пока ничего не сохранено. Пока документ редактируется, версия сохраняется каждые десять минут.",
  "history.open": "Открыть",

  "preview.label": "Версия от {when}",
  "preview.show": "Что показать",
  "preview.changes": "Изменения",
  "preview.version": "Эта версия",
  "preview.restore": "Восстановить",
  "preview.restoring": "Восстановление…",
  "preview.same": "Ничего не изменится — эта версия совпадает с текущим документом.",
  "preview.legend": "Зачёркнутое будет удалено, выделенное — добавлено.",

  "new.title": "Новый документ",
  "new.name": "Название",
  "new.namePlaceholder": "Заметки со встречи",
  "new.addressHint": "Адрес создаётся из названия.",
  "new.password": "Пароль",
  "new.optional": "Необязательно",
  "new.passwordAgain": "Пароль ещё раз",
  "new.mismatch": "Пароли не совпадают.",
  "new.protects": "Пароль защищает",
  "new.protectView": "Просмотр — без пароля документ никто не откроет",
  "new.protectEdit": "Редактирование — читать могут все, писать — только те, кто знает пароль",
  "new.keepSafe": "Сохраните пароль в надёжном месте: его нельзя восстановить или изменить.",
  "new.public": "Без пароля документ публичный: любой, у кого есть адрес, может читать и редактировать его.",
  "new.create": "Создать",
  "new.creating": "Создание…",
  "new.badName": "Используйте хотя бы одну букву или цифру.",
  "new.taken": "Документ с таким адресом уже есть. Выберите другое название.",
  "new.badPassword": "Пароль должен содержать не менее {min} символов.",
  "new.tooMany": "Слишком много документов создано только что. Подождите минуту и попробуйте снова.",

  "unlock.viewTitle": "Этот документ защищён паролем",
  "unlock.editTitle": "Разрешить редактирование",
  "unlock.viewNote": "Введите пароль, чтобы открыть его.",
  "unlock.editNote": "Этот документ может читать любой. Введите пароль, чтобы редактировать.",
  "unlock.wrong": "Неверный пароль.",
  "unlock.tooMany": "Слишком много попыток. Подождите минуту и попробуйте снова.",
  "unlock.submit": "Открыть",
  "unlock.checking": "Проверка…",

  "presence.label": "Люди в этом документе",
  "presence.selfTitle": "{name} (вы) — нажмите, чтобы сменить имя",
  "presence.selfLabel": "{name}, это вы. Сменить имя.",

  "common.close": "Закрыть",
  "common.cancel": "Отмена",
  "common.delete": "Удалить",
  "common.loading": "Загрузка…",
  "common.noServer": "Не удалось связаться с сервером.",
};

const DICTIONARIES: Record<Language, Dictionary> = { en, tr, ru };

/** Words whose form depends on a number: Russian has three of them. */
const PLURALS: Record<Language, Record<"status.uploading", Plural>> = {
  en: {
    "status.uploading": { one: "Uploading {count} picture…", other: "Uploading {count} pictures…" },
  },
  tr: {
    "status.uploading": { other: "{count} resim yükleniyor…" },
  },
  ru: {
    "status.uploading": {
      one: "Загружается {count} изображение…",
      few: "Загружаются {count} изображения…",
      many: "Загружаются {count} изображений…",
      other: "Загружаются {count} изображения…",
    },
  },
};

const plurals = new Intl.PluralRules(language);

function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match);
}

export function t(key: Key, values?: Record<string, string | number>): string {
  return fill(DICTIONARIES[language][key], values);
}

export function tCount(key: keyof (typeof PLURALS)["en"], count: number): string {
  const forms = PLURALS[language][key];
  return fill(forms[plurals.select(count)] ?? forms.other, { count });
}

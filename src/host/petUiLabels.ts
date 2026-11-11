const en={drag:'Hold and move to drag · Right-click for actions',model:'AI model',agent:'Agent / tools',notice:'Show last message',observing:'Observing',pending:'Awaiting consent',menu:'Companion actions'};
type Labels={ [K in keyof typeof en]:string };
const labels:Record<string,Labels>={
  en,
  zh:{drag:'按住移动拖动 · 右击打开功能',model:'AI 模型',agent:'Agent / 工具',notice:'查看最近消息',observing:'正在观察',pending:'等待授权',menu:'灵伴功能'},
  ja:{drag:'押して移動でドラッグ · 右クリックで操作',model:'AI モデル',agent:'Agent / ツール',notice:'最後のメッセージを表示',observing:'画面を観察中',pending:'同意待ち',menu:'仲間の操作'},
  ko:{drag:'누른 채 이동하여 끌기 · 오른쪽 클릭으로 기능',model:'AI 모델',agent:'Agent / 도구',notice:'최근 메시지 보기',observing:'화면 관찰 중',pending:'동의 대기',menu:'동반자 기능'},
  de:{drag:'Gedrückt halten und ziehen · Rechtsklick für Aktionen',model:'KI-Modell',agent:'Agent / Werkzeuge',notice:'Letzte Nachricht zeigen',observing:'Beobachtung aktiv',pending:'Wartet auf Zustimmung',menu:'Begleiter-Aktionen'},
  es:{drag:'Mantén pulsado y mueve para arrastrar · Clic derecho para acciones',model:'Modelo de IA',agent:'Agent / herramientas',notice:'Mostrar último mensaje',observing:'Observando',pending:'Esperando consentimiento',menu:'Acciones del compañero'},
  ru:{drag:'Удерживайте и перемещайте · Правая кнопка для действий',model:'Модель ИИ',agent:'Agent / инструменты',notice:'Показать последнее сообщение',observing:'Наблюдение активно',pending:'Ожидание согласия',menu:'Действия помощника'},
  ar:{drag:'اضغط وحرك للسحب · انقر بزر الفأرة الأيمن للخيارات',model:'نموذج الذكاء الاصطناعي',agent:'Agent / الأدوات',notice:'عرض آخر رسالة',observing:'المراقبة نشطة',pending:'بانتظار الموافقة',menu:'إجراءات الرفيق'},
};
export function petUiLabels(locale:string):Labels{return labels[locale.split(/[-_]/)[0]]??en;}

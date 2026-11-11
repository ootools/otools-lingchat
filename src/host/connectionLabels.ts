export const connectionLabels = {
  zh: {
    connectionsIntro: '选择要共享的数据，一次确认后连接。可随时断开，新增提供方不会自动获得授权。',
    dataConnectionsBundle: '数据连接',
    dataConnectionsHint: '下方列出本次申请的插件与数据类型。确认后才能读取与订阅变化。',
    connectSelected: '一键连接所选数据', disconnectData: '断开',
    connectionDenied: '已拒绝，可重新申请', connectionCancelled: '已取消，可重新申请', connectionExpired: '已过期，可重新申请',
  },
  en: {
    connectionsIntro: 'Choose the data to share and approve it together. Disconnect anytime; new providers are never authorized automatically.',
    dataConnectionsBundle: 'Data connections',
    dataConnectionsHint: 'The plugins and data types requested are listed below. Reading and updates begin only after approval.',
    connectSelected: 'Connect selected data', disconnectData: 'Disconnect',
    connectionDenied: 'Denied; request again', connectionCancelled: 'Cancelled; request again', connectionExpired: 'Expired; request again',
  },
  ja: {
    connectionsIntro: '共有するデータを選び、まとめて確認します。いつでも解除でき、新しい提供元は自動で許可されません。',
    dataConnectionsBundle: 'データ接続', dataConnectionsHint: '今回要求するプラグインとデータ種類です。許可後にのみ読み取りと更新を開始します。',
    connectSelected: '選択したデータを接続', disconnectData: '接続解除',
    connectionDenied: '拒否済み・再申請可能', connectionCancelled: '取消済み・再申請可能', connectionExpired: '期限切れ・再申請可能',
  },
  ko: {
    connectionsIntro: '공유할 데이터를 선택해 한 번에 승인하세요. 언제든 연결을 끊을 수 있으며 새 제공자는 자동 승인되지 않습니다.',
    dataConnectionsBundle: '데이터 연결', dataConnectionsHint: '이번에 요청할 플러그인과 데이터 유형입니다. 승인 후에만 읽기와 업데이트가 시작됩니다.',
    connectSelected: '선택한 데이터 연결', disconnectData: '연결 끊기',
    connectionDenied: '거부됨 · 다시 요청 가능', connectionCancelled: '취소됨 · 다시 요청 가능', connectionExpired: '만료됨 · 다시 요청 가능',
  },
  de: {
    connectionsIntro: 'Wähle Daten zur gemeinsamen Freigabe. Du kannst jederzeit trennen; neue Anbieter werden nicht automatisch autorisiert.',
    dataConnectionsBundle: 'Datenverbindungen', dataConnectionsHint: 'Diese Plugins und Datentypen werden angefragt. Lesen und Aktualisierungen beginnen erst nach der Freigabe.',
    connectSelected: 'Ausgewählte Daten verbinden', disconnectData: 'Trennen',
    connectionDenied: 'Abgelehnt · erneut anfragen', connectionCancelled: 'Abgebrochen · erneut anfragen', connectionExpired: 'Abgelaufen · erneut anfragen',
  },
  es: {
    connectionsIntro: 'Elige los datos y apruébalos juntos. Puedes desconectarlos cuando quieras; los nuevos proveedores no se autorizan automáticamente.',
    dataConnectionsBundle: 'Conexiones de datos', dataConnectionsHint: 'Estos son los plugins y tipos solicitados. La lectura y las actualizaciones solo empiezan después de aprobar.',
    connectSelected: 'Conectar datos seleccionados', disconnectData: 'Desconectar',
    connectionDenied: 'Denegado · vuelve a solicitar', connectionCancelled: 'Cancelado · vuelve a solicitar', connectionExpired: 'Caducado · vuelve a solicitar',
  },
  ru: {
    connectionsIntro: 'Выберите данные и подтвердите доступ вместе. Отключить можно в любой момент; новые источники автоматически не разрешаются.',
    dataConnectionsBundle: 'Подключения данных', dataConnectionsHint: 'Ниже перечислены запрашиваемые плагины и типы данных. Чтение и обновления начнутся только после подтверждения.',
    connectSelected: 'Подключить выбранные данные', disconnectData: 'Отключить',
    connectionDenied: 'Отказано · можно запросить снова', connectionCancelled: 'Отменено · можно запросить снова', connectionExpired: 'Истекло · можно запросить снова',
  },
  ar: {
    connectionsIntro: 'اختر البيانات ووافق عليها معًا. يمكنك قطع الاتصال في أي وقت؛ لا يُصرّح للموفرين الجدد تلقائيًا.',
    dataConnectionsBundle: 'اتصالات البيانات', dataConnectionsHint: 'الإضافات وأنواع البيانات المطلوبة موضحة أدناه. تبدأ القراءة والتحديثات بعد الموافقة فقط.',
    connectSelected: 'ربط البيانات المختارة', disconnectData: 'قطع الاتصال',
    connectionDenied: 'مرفوض · يمكن طلبه مجددًا', connectionCancelled: 'ملغى · يمكن طلبه مجددًا', connectionExpired: 'منتهي · يمكن طلبه مجددًا',
  },
} as const;

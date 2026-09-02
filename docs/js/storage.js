// リンク集・素材・資料の添付ファイルは、Cloudinaryの無料プラン(クレジットカード
// 登録不要)にアップロードしている。Cloud Storage for Firebaseはこの用途には
// Blazeプラン(従量課金制、クレジットカード登録必須)への切り替えが必要なため
// 見送り、代わりに無料枠のあるCloudinaryを使っている。
//
// 事前準備(README「Cloudinaryの設定」参照):
//   1. https://cloudinary.com で無料アカウントを作成(カード不要)
//   2. ダッシュボードの「Cloud name」を確認
//   3. Settings → Upload → Upload presets で「Signing Mode: Unsigned」の
//      プリセットを新規作成し、プリセット名を控える
//   4. 下記の CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET を置き換える
//
// Cloud name・アップロードプリセット名は(FirebaseのapiKeyと同様に)
// 公開されても問題ない値。ただしCloudinaryの無料/署名なしプリセットには
// Firestoreのようなメンバー限定チェックが無いため、アプリのURLとあわせて
// このプリセット名を知っていれば誰でもアップロードできてしまう
// (アップロード先が埋まる程度のいたずらは可能だが、他のデータへの
// 影響は無い)。プリセット側で許可するファイル形式・最大サイズを
// 設定しておくと多少の対策になる。
const CLOUDINARY_CLOUD_NAME = 'ivjb3fmi';
const CLOUDINARY_UPLOAD_PRESET = 'File_Uploarding_system';

const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024;

export async function uploadAttachment(folder, file) {
  if (!file) return null;
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('ファイルサイズが大きすぎます(15MBまで)');
  }
  if (CLOUDINARY_CLOUD_NAME === 'YOUR_CLOUD_NAME' || CLOUDINARY_UPLOAD_PRESET === 'YOUR_UPLOAD_PRESET') {
    throw new Error(
      'Cloudinaryが未設定です。docs/js/storage.js の CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET を設定してください。'
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw new Error('ファイルのアップロードに失敗しました');
  }
  const data = await res.json();

  return {
    path: data.public_id,
    url: data.secure_url,
    fileName: file.name,
    size: file.size,
    contentType: file.type || '',
  };
}

// Cloudinaryの無料/署名なしプリセットには、クライアント側から安全に削除する
// 手段が無い(削除にはAPIシークレットが必要で、フロントエンドに置けない)。
// そのため添付の削除操作はFirestore側の参照を消すだけで、Cloudinary上の
// ファイル実体は残り続ける(無料枠の範囲であれば実運用上は問題になりにくい。
// 気になる場合はCloudinaryダッシュボードのMedia Libraryから手動で削除できる)。
export async function deleteAttachment(path) {
  // 意図的に何もしない(上記コメント参照)
}

/**
 * 成员选择器（P08 叮一下 / P09 派活共用）
 *
 * 设计取舍：**刻意不注入 store、不发请求**。
 *   - 页面决定「给谁选」：P08 叮谁要把自己排除掉，P09 派给谁要把自己加进去，
 *     这个差别属于页面，不该塞进组件
 *   - 组件只做两件事：把 `roleName` 渲染成能看的头像块、把选中项抛回去
 *
 * 为什么不叫 `member-list`：它是**单选控件**，会 emit `select`；
 * 名字里带 list 会让人以为只是展示。
 */

/** 组件接受的最小成员形状 —— `FamilyMember` / `ThingMemberBrief` 都结构兼容 */
export interface MemberLike {
  memberId: number;
  /** 家庭称谓，例如「阿妈」—— 展示用它，不用微信昵称 */
  roleName: string;
  avatarUrl?: string | null;
  /** 是不是「我」。P09 里要显示成「我」 */
  isMe?: boolean;
}

/** 渲染后的条目（组件内部使用） */
export interface RenderedMember {
  memberId: number;
  avatarUrl: string;
  /** 没有头像时的首字兜底 */
  initial: string;
  /** 显示名：默认是称谓；`isMe` 且配了 `selfLabel` 时用 selfLabel */
  display: string;
}

function renderMembers(list: MemberLike[], selfLabel: string): RenderedMember[] {
  return (list || []).map((m) => {
    const name = (m.roleName || '').trim();
    const isSelf = m.isMe === true && selfLabel !== '';
    return {
      memberId: m.memberId,
      avatarUrl: m.avatarUrl || '',
      // 没有头像就用称谓首字 —— 比一个灰色小人好认，也不用额外请求图片
      initial: name ? name.slice(0, 1) : '家',
      display: isSelf ? selfLabel : name,
    };
  });
}

Component({
  properties: {
    /** 要选的人。顺序由页面决定（一般就是成员列表顺序） */
    list: { type: Array, value: [] },
    /** 当前选中的人；0 表示没选 */
    selectedId: { type: Number, value: 0 },
    /**
     * 「我」这条怎么显示，默认「我」。
     *
     * P08 叮谁不会传自己，所以用不上；P09 派给谁需要「我」这个选项，
     * 但显示成自己的称谓（「阿爸」）会让人以为在派给别的长辈。
     * 传空串则退化为显示称谓。
     */
    selfLabel: { type: String, value: '我' },
  },

  data: {
    items: [] as RenderedMember[],
  },

  observers: {
    // `list` 是页面传进来的原始数据，这里统一算出首字与显示名。
    // 放在 observer 而不是 WXML 里：WXML 不能调函数，用 WXS 又要多一个文件。
    'list, selfLabel'(list: MemberLike[], selfLabel: string) {
      this.setData({ items: renderMembers(list, selfLabel) });
    },
  },

  methods: {
    onPick(e: WechatMiniprogram.TouchEvent) {
      const memberId = Number(e.currentTarget.dataset.id);
      if (!memberId) return;
      this.triggerEvent('select', { memberId });
    },
  },
});

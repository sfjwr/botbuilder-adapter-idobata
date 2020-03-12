import { Activity, ActivityTypes, BotAdapter, ConversationReference, TurnContext, ResourceResponse } from 'botbuilder';
import { Botkit } from 'botkit';
import EventSource from 'eventsource';
import Url from 'url';
import axios from 'axios';

const IDOBATA_URL = 'https://idobata.io/';
const IDOBATA_EVENTD_URL = IDOBATA_URL;

interface Options {
  name: string;
  apiToken: string;
  idobataUrl?: string;
  idobataEventUrl?: string;
}

interface IdobataData {
  message: {
    id: number;
    body: string;
    room_id: number;
    mentions: Array<any>;
    sender_id: number;
    body_plain: string;
    created_at: string;
    sender_name: string;
    sender_type: string;
    sender_icon_url: string;
  };
}

interface IdobataSeed {
  last_event_id: string;
  records: {
    bot: {
      id: number;
    };
  };
}

interface IdobataEvent {
  data: IdobataData;
  type: string;
}

export class IdobataAdapter extends BotAdapter {
  private options: Options;
  private botId = '';
  public name = 'Idobata adapter';

  headers() {
    return {
      Authorization: `Bearer ${this.options.apiToken}`,
      'User-Agent': this.options.name
    };
  }

  public constructor(options: Options) {
    super();
    this.options = options;
  }

  public init(botkit: Botkit): void {
    botkit.ready(() => {
      this.connect(botkit.handleTurn.bind(botkit));
    });
  }

  public connect(logic: (context: TurnContext) => Promise<void>): void {
    const endpoint = Url.resolve(this.options.idobataEventUrl || IDOBATA_EVENTD_URL, '/api/stream');

    const stream = new EventSource(`${endpoint}?access_token=${this.options.apiToken}`, {
      headers: this.headers()
    }) as any;

    stream.on('seed', (evt: MessageEvent) => {
      const idobataSeed: IdobataSeed = JSON.parse(evt.data);
      this.botId = idobataSeed.records.bot.id.toString();
    });

    stream.on('event', (event: MessageEvent) => {
      const idobataData: IdobataEvent = JSON.parse(event.data);

      if (idobataData.type !== 'message:created') return;
      if (idobataData.data.message.sender_type === 'Bot') return;

      const mentions = idobataData.data.message.mentions;
      if (!mentions || !mentions.map(e => e.toString()).includes(this.botId)) {
        return;
      }

      const activity = {
        id: idobataData.data.message.id.toString(),
        type: ActivityTypes.Message,
        channelId: idobataData.data.message.room_id.toString(),
        channelData: {},
        from: {
          id: idobataData.data.message.sender_id.toString(),
          name: idobataData.data.message.sender_name
        },
        recipient: {
          id: this.botId,
          name: this.options.name
        },
        conversation: {
          id: idobataData.data.message.sender_id.toString(),
          name: '',
          conversationType: '',
          isGroup: false,
          tenantId: ''
        },
        text: idobataData.data.message.body_plain,
        timestamp: new Date()
      };

      const context = new TurnContext(this, activity);
      this.runMiddleware(context, logic);
    });

    stream.on('error', (event: MessageEvent) => {
      console.error(event);
    });
  }

  public async sendActivities(context: TurnContext, activities: Partial<Activity>[]): Promise<ResourceResponse[]> {
    const results: ResourceResponse[] = [];

    for await (const activity of activities) {
      const url = `${this.options.idobataUrl || IDOBATA_URL}api/messages`;

      const params = new URLSearchParams();
      params.append('message[source]', activity.text!);
      params.append('message[room_id]', activity.channelId!);
      params.append('message[format]', 'html');

      const result = await axios.post(url, params, {
        headers: this.headers()
      });

      const idobataData: IdobataData = result.data;
      results.push({
        id: idobataData.message.id.toString()
      });
    }

    return results;
  }

  // eslint-disable-next-line
  public async updateActivity(context: TurnContext, activity: Partial<Activity>): Promise<void> {}

  // eslint-disable-next-line
  public async deleteActivity(context: TurnContext, reference: Partial<ConversationReference>): Promise<void> {}

  public async continueConversation(
    reference: Partial<ConversationReference>,
    logic: (context: TurnContext) => Promise<void>
  ): Promise<void> {
    const request = TurnContext.applyConversationReference(
      { type: 'event', name: 'continueConversation' },
      reference,
      true
    );
    const context = new TurnContext(this, request);
    return this.runMiddleware(context, logic);
  }
}

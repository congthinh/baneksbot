import * as config from 'config';
import * as debugFactory from 'debug';
import NetworkModel, {Methods, RequestConfig, RequestParams} from '../network';

const debug = debugFactory('baneks-node:vk');

export type PollAnswer = {
  id: number,
  text: string,
  votes: number,
  rate: number
};

type Poll = {
  id: number,
  owner_id: number,
  created: number,
  question: string,
  votes: number,
  answers: PollAnswer[],
  anonymous: number
};

export type Link = {
  title: string,
  url: string
};

type PhotoSize = {
  type: string,
  url: string,
  width: number,
  height: number
};

type Photo = {
  id: number,
  album_id: number,
  owner_id: number,
  user_id: number,
  text: string,
  date: number,
  sizes: PhotoSize[],
  width: number,
  height: number,
  photo_75: string,
  photo_130: string,
  photo_604: string,
  photo_1280: string,
  photo_2560: string
};

type Audio = {
  id: number,
  owner_id: number,
  artist: string,
  title: string,
  duration: number,
  url: string,
  lyrics_id: number,
  album_id: number,
  genre_id: number,
  date: number,
  no_search: number,
  is_hq: number
};

type Video = {
  id: number,
  title?: string,
  photo_800?: string,
  photo_640?: string,
  photo_320?: string,
  photo_130?: string,
  owner_id: number,
  text: string
};

type Document = {
  url: string,
  title: string
};

export type Anek = {
  id: number,
  date: number,
  post_id: number,
  from_id: number,
  text: string,
  attachments: Attachment[],
  copy_history: Anek[],
  marked_as_ads: boolean,
  is_pinned: boolean,
  likes: {
    count: number
  },
  reposts: {
    count: number
  },
  comments: {
    count: number
  }
};

export type Attachment = {
  type: string,
  photo?: Photo,
  audio?: Audio,
  video?: Video,
  doc?: Document,
  poll?: Poll,
  link?: Link,
  text?: string,
  title?: string
};

type Comment = {
  id: number,
  from_id: number,
  date: number,
  text: string,
  reply_to_user: number,
  reply_to_comment: number,
  attachments: Attachment[]
};

type MultipleResponse<T> = {
  count: number,
  items: T[]
};

type VkError = {
  error_code: number,
  error_msg: string
};

interface IVkResponse<T> {
  response?: T;
  error?: VkError;
}

type AllRequestParams = {
  owner_id?: number,
  post_id?: number,
  posts?: string,
  offset?: number,
  count?: number,
  need_likes?: number
};

class Vk extends NetworkModel {
  public endpoint: string = config.get('vk.url');
  public groupId: number = config.get('vk.group_id');

  public executeCommand<R>(command: string, params: RequestParams & AllRequestParams, method: Methods = Methods.GET): Promise<R> {
    const axiosConfig: RequestConfig = {
      method,
      url: this.endpoint + command
    };

    const requestParams = Object.assign({
      _getBackoff: () => 300,
      _rule: 'vk',
      _skipQueue: true,
      access_token: config.get('vk.access_token'),
      v: config.get('vk.api_version')
    }, params);

    return this.makeRequest(axiosConfig, requestParams)
      .then((data: IVkResponse<R>): R => {
        if (data.error) {
          throw new Error(data.error.error_msg || 'Unknown error');
        }

        return data.response;
      });
  }

  public getPostById(postId: number): Promise<Anek | void> {
    debug('Making VK request wall.getById', postId);

    return this.executeCommand<Anek[]>('wall.getById', {
      _key: String(this.groupId),
      posts: this.groupId + '_' + postId
    })
      .then((posts: Anek[]) => {
        if (posts.length && posts[0]) {
          return posts[0];
        }
      });
  }

  public getPosts(offset?: number, count?: number): Promise<MultipleResponse<Anek>> {
    debug('Making VK request wall.get', offset, count);

    return this.executeCommand<MultipleResponse<Anek>>('wall.get', {
      _key: String(this.groupId),
      count,
      offset,
      owner_id: this.groupId
    });
  }

  public getCommentsCount(postId: number): Promise<number> {
    return this.getComments(postId, 0, 1)
      .then((comments: MultipleResponse<Comment>) => comments.count || 0);
  }

  public getPostsCount(): Promise<{count: number, hasPinned: boolean}> {
    return this.getPosts(0, 1)
      .then((response: MultipleResponse<Anek>) => {
        const count = response.count || 0;

        return {
          count,
          hasPinned: response.items ? response.items[0].is_pinned : false
        };
      });
  }

  public getComments(postId: number, offset?: number, count?: number): Promise<MultipleResponse<Comment>> {
    if (!postId) {
      throw new Error('Post ID is not defined');
    }

    debug('Making VK request wall.getComments', postId, offset, count);

    return this.executeCommand<MultipleResponse<Comment>>('wall.getComments', {
      _key: String(this.groupId),
      count,
      need_likes: 1,
      offset,
      owner_id: this.groupId,
      post_id: postId
    });
  }

  public getAllComments(postId: number): Promise<Comment[]> {
    return this.getCommentsCount(postId)
      .then((counter: number): Promise<Comment[]> => {
        const requests = [];
        let current = counter;
        const goal = 0;
        let step = 100;

        while (current > goal) {
          if (current - step < goal) {
            step = current - goal;
          }

          current -= step;

          requests.push(this.getComments(postId, current, step));
        }

        return this.fulfillAll(requests);
      });
  }
}

export default Vk;

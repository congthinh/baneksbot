import * as botApi from '../botApi';
import {Anek as AnekModel, ElasticHit, IAnek, IElasticSearchResult} from './mongo';

type ValidationResult = {
  ok: boolean,
  reason?: string[]
};

export async function isLong(anek: IAnek, length: number = 2000): Promise<ValidationResult> {
  const ok = anek.text.length <= length;

  return {
    ok,
    reason: !ok && ['Длина анека превышает комфортную длину в ' + length + ' символа(ов)']
  };
}

export async function isAds(anek: IAnek): Promise<ValidationResult> {
  const ok = !anek.marked_as_ads;

  return {
    ok,
    reason: !ok && ['Анек помечен как реклама']
  };
}

export async function hasHashTags(anek: IAnek): Promise<ValidationResult> {
  const hashTag = (anek.text || '').match(/(?:\s|^)#[A-Za-z0-9а-яА-Я\-\.\_]+(?:\s|$)/g);
  const ok = !hashTag;

  return {
    ok,
    reason: !ok && ['Анек содержит хэштеги: ' + hashTag.join(', ')]
  };
}

export async function similar(anek: IAnek, similarity: number = 0.7): Promise<ValidationResult> {
  return new Promise((resolve, reject) => {
    return AnekModel.esSearch({
      query: {
        match: {
          text: anek.text
        }
      }
    }, {
      hydrateWithESResults: true
    }, (err: Error, result: IElasticSearchResult<ElasticHit>) => {
      if (err) {
        return reject(err);
      }

      if (result && result.hits && result.hits.hits) {
        const exactAnek = result.hits.hits.find((someAnek) => someAnek.post_id === anek.post_id);
        let reference = 0;

        if (exactAnek) {
          reference = exactAnek._esResult._score;

          const otherAneks = result.hits.hits
            .filter((someAnek) => someAnek.post_id !== exactAnek.post_id && someAnek._esResult._score / reference >= similarity)
            .map((hit) => 'Совпадение с анеком ' + hit.post_id + ': ' + Math.round(hit._esResult._score / reference * 100) + '%');
          const ok = !otherAneks.length;

          return resolve({
            ok,
            reason: !ok && otherAneks
          });
        }

        return resolve({
          ok: true
        });
      }

      return resolve({
        ok: true
      });
    });
  });
}

export default async function inspect(anek: IAnek): Promise<ValidationResult> {
  const results = await botApi.bot.fulfillAll([isLong(anek), isAds(anek), hasHashTags(anek), similar(anek)]);

  return results.reduce((acc: ValidationResult, current) => ({
    ok: acc.ok && current.ok,
    reason: current.reason ? acc.reason.concat(current.reason) : acc.reason
  }), {
    ok: true,
    reason: []
  });
}
